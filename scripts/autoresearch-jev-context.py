"""Question discovery selected by grouped, budgeted context outcomes.

train sees a DEV-ONLY file. test loads a frozen artifact and a separate TEST-ONLY
file exactly once. Unknown candidates are never turned into negative labels.
The exported selector is a shadow policy, not an activated runtime model.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import statistics
import subprocess
from pathlib import Path
from jev_question_quality import lint_question, redundant_columns

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('research', ROOT/'scripts/autoresearch-jev.py')
research = importlib.util.module_from_spec(spec); spec.loader.exec_module(research)
cal = research.cal
POLICY = {'version': 'budgeted-context-dependencies-v2', 'allRequired': .55, 'requiredRecall': .30,
          'helperRecall': .10, 'ndcg': .05, 'reviewedNegativePenalty': .05}
SCREEN_POLICY = {'version': 'uncertain-screen-pilot-v1', 'clearReject': .25,
                 'clearPass': .60, 'pilotMinRange': .15, 'pilotPerGroup': 3}


def validate(data, split):
    episodes = data['episodes']
    if not episodes or any(e['split'] != split for e in episodes):
        raise ValueError('Separate dev-only and test-only datasets required')
    if len({e['id'] for e in episodes}) != len(episodes): raise ValueError('Duplicate episode')
    for e in episodes:
        if not e['group'] or e['budget'] <= 0 or e['limit'] <= 0 or not e['required']:
            raise ValueError('Explicit groups, budget and reviewed requirements required')
        if len({r['id'] for r in e['candidates']}) != len(e['candidates']): raise ValueError('Duplicate candidate')
        for r in e['candidates']:
            if r['label'] not in (None, 0, 1) or r['tokens'] <= 0: raise ValueError('Invalid reviewed row')
            if not all(isinstance(v,(float,int)) and math.isfinite(v) for v in r['features'].values()):
                raise ValueError('Nonfinite feature')
    return episodes


def selected_packet(episode, scores):
    """Frozen shadow selector: score ordering, full source, overlap and budget bounds.

    No labels/required symbols are read by this function. No threshold is tuned on test.
    """
    if len(scores) != len(episode['candidates']) or any(not math.isfinite(s) for s in scores):
        raise ValueError('Invalid scores')
    selected=[]; used=0
    for row,_score in sorted(zip(episode['candidates'],scores),key=lambda p:(-p[1],p[0]['id'])):
        if not row['complete'] or used+row['tokens'] > episode['budget']: continue
        c=row['candidate']
        if any(s['candidate']['file']==c['file'] and s['candidate']['startLine']<=c['endLine']
               and c['startLine']<=s['candidate']['endLine'] for s in selected): continue
        selected.append(row); used+=row['tokens']
        if len(selected) == episode['limit']: break
    # One-hop AST relations from the frozen pool, never required-symbol labels.
    # Small implementations may retain small local callees instead of a peripheral
    # tail result. At most two substitutions, no source injection or budget growth.
    by_id={r['id']:r for r in episode['candidates']}
    demands=[]
    for anchor in selected:
        if anchor['tokens']>512:continue
        for dep_id in anchor.get('dependencies',[]):
            dep=by_id.get(dep_id)
            if dep and dep['complete'] and dep['tokens']<=512 and dep not in selected:
                demands.append((anchor,dep))
    protected={a['id'] for a,_ in demands}; added=0
    for anchor,dep in demands:
        if added>=2:break
        if dep in selected:continue
        c=dep['candidate']
        if any(s['candidate']['file']==c['file'] and s['candidate']['startLine']<=c['endLine'] and c['startLine']<=s['candidate']['endLine'] for s in selected):continue
        if len(selected)>=episode['limit'] or used+dep['tokens']>episode['budget']:
            victim=next((r for r in reversed(selected) if r['id'] not in protected and used-r['tokens']+dep['tokens']<=episode['budget']),None)
            if victim is None:continue
            selected.remove(victim);used-=victim['tokens']
        selected.insert(selected.index(anchor)+1,dep)
        used+=dep['tokens'];protected.add(dep['id']);added+=1
    return selected


def episode_metrics(e, selected):
    keys=[r['key'] for r in selected if r['complete']]
    required={r['key'] for r in e['required']}; helpers={r['key'] for r in e['required'] if r['role']=='helper'}
    hit=required.intersection(keys)
    dcg=sum(1/math.log2(keys.index(k)+2) for k in hit)
    ideal=sum(1/math.log2(i+2) for i in range(min(len(required),e['limit'])))
    known={r['id']:r['label'] for r in e['candidates']}
    negatives=sum(known.get(r['id'])==0 for r in selected)
    return {'allRequired':int(hit==required),'requiredRecall':len(hit)/len(required),
            'helperRecall':len(helpers.intersection(keys))/len(helpers) if helpers else None,
            'ndcg':dcg/ideal if ideal else 0,'reviewedNegativeFraction':negatives/max(1,len(selected)),
            'unknownFraction':sum(known.get(r['id']) is None for r in selected)/max(1,len(selected)),
            'tokens':sum(r['tokens'] for r in selected), 'missing':sorted(required-hit)}


def summarize(records):
    # Equal weight to behavior families; paraphrases cannot dominate the objective.
    groups=sorted({r['group'] for r in records})
    metrics={}
    for key in ['allRequired','requiredRecall','helperRecall','ndcg','reviewedNegativeFraction','unknownFraction','tokens']:
        values=[]
        for group in groups:
            v=[r[key] for r in records if r['group']==group and r[key] is not None]
            if v: values.append(statistics.mean(v))
        metrics[key]=statistics.mean(values) if values else None
    metrics['objective']=sum(POLICY[k]*(metrics[k] or 0) for k in ['allRequired','requiredRecall','helperRecall','ndcg'])-.05*metrics['reviewedNegativeFraction']
    metrics.update(episodes=len(records),groups=len(groups),allRequiredCount=sum(r['allRequired'] for r in records))
    return metrics


def training_rows(episodes):
    rows=[r for e in episodes for r in e['candidates'] if r['label'] is not None and r['complete']]
    if {r['label'] for r in rows}!={0,1}: raise ValueError('Training fold needs reviewed positives AND negatives')
    return rows


def predict(model, rows):
    weight=model.get('learnedWeight',1.)
    return [weight*p+(1-weight)*r['features']['localScore'] for r,p in zip(rows,cal.predict(model,rows))]


def fit_model(episodes,names,weight):
    return {**cal.train(training_rows(episodes),names),'learnedWeight':weight}


def validate_holdout(artifact, data, episodes):
    if artifact.get('preservationGate',{}).get('passed') is False:raise ValueError('Development preservation gate failed; do not consume holdout')
    if set(artifact['developmentGroups'])&{e['group'] for e in episodes}:
        raise ValueError('Holdout group leakage')
    if artifact['policy']!=POLICY: raise ValueError('Frozen selector policy changed')
    if artifact['snapshot']!=data['snapshot']: raise ValueError('Frozen snapshot changed')
    if artifact.get('dependencyContractVersion')!=data.get('dependencyContract',{}).get('version'):
        raise ValueError('Frozen dependency contract changed')
    expected=set(artifact['baseFeatures'])
    if any(set(r['features'])!=expected for e in episodes for r in e['candidates']):
        raise ValueError('Holdout structural feature contract changed')
    if set(artifact.get('featureContracts',{}))!=set(artifact['questions']):
        raise ValueError('Missing frozen feature measurement contracts')
    for name,q in artifact['questions'].items():
        if artifact['featureContracts'][name].get(name)!=q:
            raise ValueError('Frozen feature question changed')


def columns(name, question, encoding="mean_spread"):
    if question["type"] == "score" and encoding == "distribution":
        return [f"{name}_p{i}" for i in range(len(question["criteria"]))]
    return research.columns(name, question)


def load_proposals(filename):
    rounds = json.loads(Path(filename).read_text(encoding='utf-8'))
    if not isinstance(rounds,list) or not 1 <= len(rounds) <= 10:
        raise ValueError('Expected 1-10 manually reviewed question sets')
    for questions in rounds: research.validate_questions(questions)
    return rounds


def feature_state(episode, row, contextual=False):
    state = {"query":episode["query"], "candidate":row["candidate"]}
    if contextual:
        # Frozen local context, excluding the candidate; no labels or gold involved.
        local = selected_packet(episode, [r["features"]["localScore"] for r in episode["candidates"]])
        state["selected"] = [r["candidate"] for r in local if r["id"] != row["id"] and len(r['candidate']['content']) <= 4000][:3]
    return state


def frozen_features(rows, artifact, featurize):
    # Companion questions affect a Jev measurement. Replay the exact ordered
    # question batch that produced each accepted column, even rejected companions.
    output=[{} for _ in rows]; batches={}
    for name,questions in artifact['featureContracts'].items():
        key=json.dumps(questions,separators=(',',':'))
        batches.setdefault(key,[]).append(name)
    for contract,names in batches.items():
        questions=json.loads(contract);values=featurize(rows,questions)
        if len(values)!=len(rows):raise ValueError('Holdout feature row count')
        cols=[col for name in names for col in columns(name,artifact['questions'][name],artifact.get('encoding','mean_spread'))]
        for out,values_row in zip(output,values):
            for col in cols:
                value=values_row[col]
                if not isinstance(value,(int,float)) or not math.isfinite(value):raise ValueError('Invalid frozen feature')
                out[col]=value
    return output


def assess(episodes, model=None, baseline=None, local_policy=False):
    records=[]
    for e in episodes:
        if baseline: selected=e['baseline'][baseline]
        else:
            scores=[r['features']['localScore'] for r in e['candidates']] if local_policy else predict(model,e['candidates'])
            selected=selected_packet(e,scores)
        records.append({'id':e['id'],'group':e['group'],**episode_metrics(e,selected),
                        'selected':[r['id'] for r in selected]})
    return {'metrics':summarize(records),'episodes':records}


def cross_validate(episodes,names,protected=None):
    groups=sorted({e['group'] for e in episodes})
    if len(groups)<3: raise ValueError('At least three development groups required')
    folds=[]
    for i in range(min(5,len(groups))):
        held=set(groups[i::min(5,len(groups))])
        fit=[e for e in episodes if e['group'] not in held]; val=[e for e in episodes if e['group'] in held]
        model=cal.train(training_rows(fit),names)
        folds.append((model,val))
    trials=[]
    for weight in [0.,.25,.5,.75,1.]:
        records=[];predictions={}
        for model,val in folds:
            blended={**model,'learnedWeight':weight}
            records+=assess(val,model=blended)['episodes']
            for e in val:predictions[e['id']]=predict(blended,e['candidates'])
        trials.append({'metrics':summarize(records),'episodes':records,'predictions':predictions,'learnedWeight':weight})
    # Compare against the actual local ordering, not only an overfit classifier.
    # Hyperparameter selection uses DEV only; lower model weight wins exact ties.
    eligible=[t for t in trials if not protected or all(
        n['allRequired']>=o['allRequired'] for o,n in zip(protected,t['episodes']))]
    return max(eligible or trials,key=lambda t:(t['metrics']['objective'],-t['learnedWeight']))


def feedback(episodes, cv, limit=6):
    # Errors of the selected packet, not just pointwise classifier residuals.
    by_id={e['id']:e for e in episodes}; out=[]
    ordered=sorted(cv['episodes'],key=lambda r:(r['allRequired'],r['requiredRecall'],r['id']))
    picks=ordered[:limit//2]+list(reversed(ordered))[:limit-limit//2]
    for record in picks:
        e=by_id[record['id']]; selected=set(record['selected'])
        reviewed=[(i,r) for i,r in enumerate(e['candidates']) if r['label'] is not None]
        reviewed.sort(key=lambda p:(p[1]['key'] not in record['missing'],p[1]['id'] not in selected))
        for i,r in reviewed[:2]:
            out.append({'query':e['query'],'candidate':{**r['candidate'],'content':r['candidate']['content'][:3500]},
                        'reviewedLabel':r['label'],'selected':r['id'] in selected,'prediction':cv['predictions'][e['id']][i],
                        'contextMissingRequirements':len(record['missing']),'budget':e['budget']})
    return out


def diagnose(episodes):
    out=[]
    for e in episodes:
        for required in e['required']:
            key=required['key']; found=[r for r in e['candidates'] if r['key']==key]
            selected={r['key'] for r in e['baseline']['current'] if r['complete']}
            stage='selected' if key in selected else 'retrieval' if not found else 'source-incomplete' if not any(r['complete'] for r in found) else 'evaluation' if key not in e['trace']['evaluated'] else 'diversity' if key not in e['trace']['diversified'] else 'budget-or-selection'
            out.append({'episode':e['id'],'requirement':key,'stage':stage})
    return out


def discover(episodes,propose,featurize,screen,rounds=3,seed=None,encoding="mean_spread",contextual=False):
    base=sorted(set.intersection(*(set(r['features']) for e in episodes for r in e['candidates'])))
    names=base[:];accepted={};contracts={};work=copy.deepcopy(episodes);best=cross_validate(work,names);history=[];plateau=0
    seed_comparison=None
    if seed and seed['questions']:
        # Replay prior DEV discoveries under their exact measurement contracts.
        # Refit and revalidate on the new pool; previous weights are a control only.
        flat=[feature_state(e,r,contextual) for e in work for r in e['candidates']]
        values=frozen_features(flat,seed,featurize)
        seeded=copy.deepcopy(work)
        for row,values_row in zip([r for e in seeded for r in e['candidates']],values):row['features'].update(values_row)
        seed_comparison=assess(seeded,model=seed['model'])
        for name,q in seed['questions'].items():
            cols=columns(name,q,encoding)
            if set(cols)&set(names):raise ValueError('Seed feature collision')
            trial=copy.deepcopy(work)
            for row,values_row in zip([r for e in trial for r in e['candidates']],values):row['features'].update({c:values_row[c] for c in cols})
            result=cross_validate(trial,names+cols,best['episodes'])
            keep=result['metrics']['objective']>best['metrics']['objective']+.002 and all(
                n['allRequired']>=o['allRequired'] for o,n in zip(best['episodes'],result['episodes']))
            history.append({'round':-1,'name':name,'action':'seed','accepted':keep,'metrics':result['metrics'],'question':q})
            if keep:
                accepted[name]=q;contracts[name]=copy.deepcopy(seed['featureContracts'][name])
                names+=cols;work=trial;best=result
    for iteration in range(rounds):
        questions=propose(iteration,copy.deepcopy(accepted),feedback(work,best))
        if not questions: break
        research.validate_questions(questions)
        screened={}
        examples=[{'query':x['query'],'candidate':{**x['candidate'],'content':x['candidate']['content'][:700]}} for x in feedback(work,best)[:6]]
        forbidden={r['candidate']['metadata'].get('symbolName','') for e in work for r in e['candidates']}
        for name,q in questions.items():
            newcols=columns(name,q,encoding);oldcols=columns(name,accepted[name],encoding) if name in accepted else []
            lint=lint_question(q)
            if set(newcols)&(set(names)-set(oldcols)) or any(len(s)>5 and s in q['instructions'] for s in forbidden) or 'counting-or-arithmetic' in lint:
                history.append({'round':iteration,'name':name,'action':'reject-contract','accepted':False});continue
            check=screen(q,examples)
            if set(check)!={'answerable','atomic','applicable','variable'} or any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in check.values()): raise ValueError('Invalid screen')
            history.append({'round':iteration,'name':name,'action':'screen','values':check,'question':q})
            if min(check.values())>SCREEN_POLICY['clearReject'] and accepted.get(name)!=q: screened[name]=q
        if not screened:
            plateau+=1
            if plateau>=2: break
            continue
        # Screening probabilities are not calibrated validity labels. Resolve the
        # uncertain band with a small, label-blind DEV pilot before full extraction.
        uncertain={name:q for name,q in screened.items() if min(next(
            h['values'] for h in reversed(history) if h['name']==name and h['action']=='screen'
        ).values()) < SCREEN_POLICY['clearPass']}
        if uncertain:
            pilot=[]
            for group in sorted({e['group'] for e in work}):
                e=next(e for e in work if e['group']==group)
                rows=e['candidates']
                indices=sorted({0,len(rows)//2,len(rows)-1}) if rows else []
                pilot.extend(feature_state(e,rows[i],contextual) for i in indices)
            pilot_values=featurize(pilot,uncertain)
            if len(pilot_values)!=len(pilot): raise ValueError('Pilot feature row count mismatch')
            for name,q in uncertain.items():
                ranges={}
                for col in columns(name,q,encoding):
                    vals=[v[col] for v in pilot_values]
                    if not vals or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in vals):
                        raise ValueError('Invalid pilot features')
                    ranges[col]=max(vals)-min(vals)
                varies=max(ranges.values())>=SCREEN_POLICY['pilotMinRange']
                history.append({'round':iteration,'name':name,'action':'pilot','ranges':ranges,'proceed':varies})
                if not varies: del screened[name]
        if not screened:
            plateau+=1
            if plateau>=2:break
            continue
        flat=[feature_state(e,r,contextual) for e in work for r in e['candidates']]
        values=featurize(flat,screened)
        if len(values)!=len(flat): raise ValueError('Feature row count mismatch')
        improved=False
        for name,q in screened.items():
            trial=copy.deepcopy(work);idx=0;cols=columns(name,q,encoding)
            for e in trial:
                for r in e['candidates']:
                    if any(c not in values[idx] or not isinstance(values[idx][c],(int,float)) or not math.isfinite(values[idx][c]) for c in cols): raise ValueError('Invalid features')
                    r['features'].update({c:values[idx][c] for c in cols});idx+=1
            oldcols=columns(name,accepted[name],encoding) if name in accepted else []
            trial_names=[n for n in names if n not in oldcols]+cols
            result=cross_validate(trial,trial_names,best['episodes'])
            # Context gains cannot purchase loss of previously covered rules in CV.
            keep=result['metrics']['objective']>best['metrics']['objective']+.002 and all(
                new['allRequired']>=old['allRequired'] for old,new in zip(best['episodes'],result['episodes']))
            correlated=redundant_columns(training_rows(trial),cols,[n for n in names if n not in oldcols])
            history.append({'round':iteration,'name':name,'action':'revise' if oldcols else 'add','accepted':keep,
                            'metrics':result['metrics'],'correlatedColumns':correlated,'question':q})
            if keep:
                accepted[name]=q;contracts[name]=copy.deepcopy(screened)
                work=trial;names=trial_names;best=result;improved=True
        plateau=0 if improved else plateau+1
        if plateau>=2:break
    baseline_cv=cross_validate(episodes,base)
    return {'schemaVersion':1,'deploy':False,'encoding':encoding,'contextual':contextual,'policy':POLICY,'screenPolicy':SCREEN_POLICY,'questions':accepted,'featureContracts':contracts,'model':fit_model(work,names,best['learnedWeight']),
            'baselineModel':fit_model(episodes,base,baseline_cv['learnedWeight']),'baseFeatures':base,'history':history,
            'dev':{'selected':{k:v for k,v in best.items() if k!='predictions'},'local':assess(episodes,baseline='local'),
                   'current':assess(episodes,baseline='current'),'sameSelectorLocal':assess(episodes,local_policy=True),
                   'fittedBaseline':{k:v for k,v in baseline_cv.items() if k!='predictions'}},
            'seedControl':seed_comparison,
            'developmentGroups':sorted({e['group'] for e in episodes}),'failureStages':diagnose(episodes)}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['train','test']);p.add_argument('input');p.add_argument('output')
    p.add_argument('--encoding',choices=['mean_spread','distribution'],default='mean_spread');p.add_argument('--contextual',action='store_true')
    p.add_argument('--artifact');p.add_argument('--seed-artifact');p.add_argument('--preserve-artifact');p.add_argument('--live',action='store_true');p.add_argument('--proposer-model');p.add_argument('--proposals');p.add_argument('--rounds',type=int,default=3)
    p.add_argument('--max-cost',type=float,default=2);p.add_argument('--max-requests',type=int,default=2000)
    args=p.parse_args()
    if not args.live or not 1<=args.rounds<=10 or not 0<args.max_cost or args.max_requests<1:p.error('Explicit --live and valid budgets required')
    if Path(args.output).exists():p.error('Refuse to overwrite experiment; preserve frozen results')
    data=json.loads(Path(args.input).read_text(encoding='utf-8'));episodes=validate(data,'dev' if args.mode=='train' else 'test')
    ledger={'cost':0.,'requests':0,'models':[],'contracts':[]};observations=[]
    def transport(payload):
        planned=len(payload.get('rows',[None]))
        if ledger['cost']>=args.max_cost or ledger['requests']+planned>args.max_requests:raise ValueError('Research budget reached')
        result=subprocess.run(['node','scripts/jev-research-transport.mjs'],input=json.dumps(payload),text=True,encoding='utf-8',capture_output=True,cwd=ROOT,timeout=900)
        if result.returncode:raise ValueError('Research transport failed; no provider body exposed')
        out=json.loads(result.stdout);observations.extend(out.get('observations',[]))
        for d in out.get('diagnostics',[{'cost':out.get('usage',{}).get('cost',0),'requests':1,'models':[out.get('model')]}]):
            ledger['cost']+=d['cost'];ledger['requests']+=d['requests'];ledger['models']+=d.get('models',[])
            if d.get('contractHash'):ledger['contracts'].append(d['contractHash'])
        return out
    def features(rows,questions):return transport({'mode':'features','rows':rows,'questions':questions})['rows']
    if args.mode=='train':
        if bool(args.proposer_model) == bool(args.proposals):p.error('Choose --proposals for manual questions OR an explicit --proposer-model')
        proposals=load_proposals(args.proposals) if args.proposals else None
        def propose(i,accepted,examples):
            if proposals is not None:
                print(json.dumps({'round':i,'phase':'manual-questions'}),flush=True)
                return copy.deepcopy(proposals[i]) if i < len(proposals) else {}
            print(json.dumps({'round':i,'phase':'propose','accepted':list(accepted)}),flush=True)
            return transport({'mode':'propose','model':args.proposer_model,'accepted':accepted,'examples':examples,
                'contextual':args.contextual,'task':'Discover atomic source-grounded features to select a complete useful code context under a token budget. Development feedback describes missing required rules/helpers and selected hard negatives. Optimize completeness of the packet, not only per-candidate label fit. Use only supplied source and relations. The selected field is available only when contextual mode is enabled; it is a frozen local packet excluding the candidate, not an oracle answer.'})['questions']
        seed=None
        if args.seed_artifact:
            seed=json.loads(Path(args.seed_artifact).read_text(encoding='utf-8'))
            if seed.get('encoding','mean_spread')!=args.encoding or seed.get('contextual',False)!=args.contextual:raise ValueError('Seed measurement state or encoding changed')
            if seed['policy']['version'] not in ['budgeted-context-v1',POLICY['version']] or seed['snapshot']!=data['snapshot']:raise ValueError('Seed policy/snapshot mismatch')
            if not set(seed['developmentGroups'])<={e['group'] for e in episodes}:raise ValueError('Seed development groups must remain development')
        result=discover(episodes,propose,features,lambda q,e:transport({'mode':'screen','question':q,'examples':e})['screening'],args.rounds,seed,args.encoding,args.contextual)
        result['proposalSource']='manual' if proposals is not None else args.proposer_model
        if args.proposals:result['proposalSha256']=hashlib.sha256(Path(args.proposals).read_bytes()).hexdigest()
        if seed:result['seedArtifactSha256']=hashlib.sha256(Path(args.seed_artifact).read_bytes()).hexdigest()
        if args.preserve_artifact:
            reference_bytes=Path(args.preserve_artifact).read_bytes();reference=json.loads(reference_bytes)
            required_ids={e['id'] for e in reference['dev']['selected']['episodes'] if e['allRequired']}
            current={e['id']:e['allRequired'] for e in result['dev']['selected']['episodes']}
            if not required_ids<=set(current):raise ValueError('Preservation reference episodes absent')
            lost=sorted(e for e in required_ids if not current[e])
            result['preservationGate']={'passed':not lost,'lost':lost,'referenceSha256':hashlib.sha256(reference_bytes).hexdigest(),'referenceComplete':len(required_ids)}
    else:
        if not args.artifact:p.error('--artifact required')
        artifact_bytes=Path(args.artifact).read_bytes();artifact=json.loads(artifact_bytes)
        validate_holdout(artifact,data,episodes)
        if artifact['questions']:
            values=frozen_features([feature_state(e,r,artifact.get('contextual',False)) for e in episodes for r in e['candidates']],artifact,features)
            for r,v in zip([r for e in episodes for r in e['candidates']],values):r['features'].update(v)
        selected=assess(episodes,model=artifact['model']);baseline=assess(episodes,model=artifact['baselineModel'])
        result={'schemaVersion':1,'deploy':False,'artifactSha256':hashlib.sha256(artifact_bytes).hexdigest(),
                'test':{'selected':selected,'fittedBaseline':baseline,'local':assess(episodes,baseline='local'),
                        'current':assess(episodes,baseline='current'),'sameSelectorLocal':assess(episodes,local_policy=True)},
                'failureStages':diagnose(episodes),'note':'One frozen holdout evaluation. No fitting, question changes or runtime activation.'}
    result.update(datasetSha256=hashlib.sha256(Path(args.input).read_bytes()).hexdigest(),snapshot=data['snapshot'],labelSource=data['labelSource'],dependencyContractVersion=data.get('dependencyContract',{}).get('version'),
                  usage={**ledger,'models':sorted(set(filter(None,ledger['models']))),'contracts':sorted(set(ledger['contracts']))},featureObservations=observations)
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    Path(args.output).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'questions':list(result.get('questions',{})),'usage':result['usage'],'deploy':False}),flush=True)


if __name__=='__main__':main()
