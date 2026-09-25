"""Offline, development-only question discovery; never activates a runtime model.
Rows: {group, split:dev|test, label:0|1, query, candidate:WorkingResult, features:{localScore,...}}.
--proposals replays a JSON list of proposal rounds; --proposer-model uses an explicitly chosen LLM.
Jev feature calls require --live. Test source/labels never reach the proposer or selection loop.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import math
import subprocess
from pathlib import Path
from jev_question_quality import lint_question, redundant_columns, feedback_examples, screen_examples

spec = importlib.util.spec_from_file_location("cal", Path(__file__).with_name("calibrate-jev.py"))
cal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cal)


def validate_questions(questions):
    import re
    if not isinstance(questions, dict) or not 1 <= len(questions) <= 3:
        raise ValueError("Each proposal requires 1-3 atomic questions")
    for name, q in questions.items():
        if not isinstance(q,dict) or set(q)-{'type','instructions','criteria'}: raise ValueError('Unknown question fields')
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,60}", name) or q.get("type") not in ("noul", "score"):
            raise ValueError("Invalid feature question")
        if not isinstance(q.get("instructions"), str) or not q["instructions"].strip() or len(q["instructions"]) > 1200:
            raise ValueError("Invalid instructions")
        if q['type']=='noul' and 'criteria' in q and (not isinstance(q['criteria'],dict) or set(q['criteria'])!={'true','false'}
                or any(not isinstance(s,str) or not s.strip() or len(s)>1200 for s in q['criteria'].values())):
            raise ValueError('Noul criteria must describe true and false')
        if q["type"] == "score" and (not isinstance(q.get("criteria"), list) or not 2 <= len(q["criteria"]) <= 10
                or any(not isinstance(s,str) or not s.strip() or len(s)>1200 for s in q["criteria"])):
            raise ValueError("Score requires standalone descriptive levels")


def columns(name, q):
    return [name] if q["type"] == "noul" else [name+"_mean", name+"_spread"]


def discover(rows, propose, featurize, rounds=3, minimum_gain=.002, screen=None):
    rows=copy.deepcopy(rows)
    if any(r.get("label") not in (0,1) or r.get("split") not in ("dev","test") or not r.get("group") for r in rows):
        raise ValueError("Reviewed labels and explicit grouped split required")
    dev=[r for r in rows if r["split"]=="dev"];test=[r for r in rows if r["split"]=="test"]
    groups={r['group'] for r in dev}
    if len(groups)<3 or not test or groups & {r['group'] for r in test}:
        raise ValueError("Disjoint test groups and at least three development groups required")
    base=sorted(set.intersection(*(set(r['features']) for r in dev)))
    if 'localScore' not in base or any(n not in r['features'] or not math.isfinite(r['features'][n]) for r in rows for n in base):
        raise ValueError("Finite baseline features required")
    accepted={};names=list(base);best=cal.cv(dev,names);history=[];plateau=0
    for iteration in range(rounds):
        # Only development rows are visible here. Test data cannot affect proposals or stopping.
        questions=propose(iteration,copy.deepcopy(accepted),copy.deepcopy(dev))
        if not questions: break
        validate_questions(questions)
        improved=False
        for name,q in questions.items():
            if name in base or set(columns(name,q)) & set(base) or len(accepted)>=12 and name not in accepted: continue
            if accepted.get(name)==q: continue
            oldcols=columns(name,accepted[name]) if name in accepted else []
            if set(columns(name,q)) & (set(names)-set(oldcols)):
                history.append({'round':iteration,'question':name,'questionContract':q,'action':'reject-column-collision','accepted':False})
                continue
            lint = lint_question(q)
            if 'counting-or-arithmetic' in lint:
                history.append({'round':iteration,'question':name,'questionContract':q,'action':'lint','accepted':False,'lint':lint})
                continue
            screening = screen(q, screen_examples(dev)) if screen else None
            if screening is not None and (set(screening) != {'answerable','atomic','applicable','variable'} or
                    any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in screening.values())):
                raise ValueError('Invalid screening response')
            if screening is not None and min(screening.values()) < .6:
                history.append({'round':iteration,'question':name,'questionContract':q,'action':'screen','accepted':False,'screening':screening,'lint':lint})
                continue
            values=featurize([{k:r[k] for k in ('query','candidate')} for r in dev],{name:q})
            if len(values)!=len(dev): raise ValueError('Feature row count mismatch')
            newcols=columns(name,q);oldcols=columns(name,accepted[name]) if name in accepted else []
            trial=copy.deepcopy(dev)
            for r,value in zip(trial,values):
                if any(c not in value or not isinstance(value[c],(int,float)) or not math.isfinite(value[c]) for c in newcols):
                    raise ValueError('Invalid feature response')
                r['features'].update(value)
            varied=any(max(r['features'][c] for r in trial)-min(r['features'][c] for r in trial)>.01 for c in newcols)
            candidate_names=[n for n in names if n not in oldcols]+newcols
            correlated = redundant_columns(trial,newcols,[n for n in names if n not in oldcols])
            score=cal.cv(trial,candidate_names) if varied else best
            keep=varied and score < best-minimum_gain
            history.append({'round':iteration,'question':name,'questionContract':q,'action':'revise' if oldcols else 'add','accepted':keep,'cvBrier':score,'varied':varied,'correlatedColumns':correlated,'screening':screening,'lint':lint})
            if keep: accepted[name]=q;dev=trial;names=candidate_names;best=score;improved=True
        # Remove redundant questions only on development CV.
        for name in list(accepted):
            trial_names=[n for n in names if n not in columns(name,accepted[name])]
            correlated=redundant_columns(dev,columns(name,accepted[name]),trial_names)
            redundant=bool(correlated) and all(correlated.values())
            score=cal.cv(dev,trial_names)
            if score<=best or redundant and score<=best+1e-4:
                del accepted[name];names=trial_names;best=score
                history.append({'round':iteration,'question':name,'action':'drop','accepted':True,'cvBrier':score,'correlatedColumns':correlated})
        plateau=0 if improved else plateau+1
        if plateau>=2: break
    # Read test features exactly once, after every choice has been frozen.
    if accepted:
        values=featurize([{k:r[k] for k in ('query','candidate')} for r in test],accepted)
        if len(values)!=len(test): raise ValueError('Test feature row count mismatch')
        for r,v in zip(test,values):
            r['features'].update(v)
            if any(n not in r['features'] or not math.isfinite(r['features'][n]) for n in names): raise ValueError('Invalid test features')
    model=cal.train(dev,names);baseline=cal.train(dev,base)
    feature_sets={'local':['localScore'],'local_structural':base,
                  'local_jev':['localScore']+[n for n in names if n not in base], 'all':names}
    ablations={key:{'features':cols,'devCvBrier':cal.cv(dev,cols),
        'test':cal.metrics([r['label'] for r in test],cal.predict(cal.train(dev,cols),test))}
        for key,cols in feature_sets.items()}
    return {'schemaVersion':1,'deploy':False,'questions':accepted,'model':model,'history':history,'devCvBrier':best,
        'test':{'baseline':cal.metrics([r['label'] for r in test],cal.predict(baseline,test)),
                'selected':cal.metrics([r['label'] for r in test],cal.predict(model,test))},
        'ablations':ablations,'screeningEnabled':screen is not None,
        'note':'Exploratory question discovery. Test evaluated only after selection. Independent labels and external validation required.'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('input');p.add_argument('output');p.add_argument('--live',action='store_true')
    p.add_argument('--proposals');p.add_argument('--proposer-model');p.add_argument('--rounds',type=int,default=3)
    p.add_argument('--max-cost',type=float,default=1);p.add_argument('--max-requests',type=int,default=1000)
    args=p.parse_args()
    if not args.live or not(args.proposals or args.proposer_model): p.error('--live and --proposals or --proposer-model required')
    if not 1<=args.rounds<=10 or args.max_cost<=0 or args.max_requests<1: p.error('Invalid research budget')
    rows=json.loads(Path(args.input).read_text(encoding='utf-8'));ledger={'cost':0.,'requests':0,'models':[],'contracts':[]};observations=[]
    root=Path(__file__).resolve().parent.parent
    def transport(payload):
        if ledger['cost']>=args.max_cost or ledger['requests']+len(payload.get('rows',[None]))>args.max_requests:
            raise ValueError('Research budget exhausted before next batch')
        run=subprocess.run(['node',str(root/'scripts/jev-research-transport.mjs')],input=json.dumps(payload),text=True,encoding='utf-8',capture_output=True,cwd=root,timeout=900)
        if run.returncode: raise ValueError('Research transport failed; no deployment artifact produced')
        data=json.loads(run.stdout)
        observations.extend(data.get('observations',[]))
        for d in data.get('diagnostics',[{'cost':data.get('usage',{}).get('cost',0),'requests':1,'models':[data.get('model')]}]):
            ledger['cost']+=d['cost'];ledger['requests']+=d['requests']
            ledger['models']+=d.get('models',[])
            if d.get('contractHash'): ledger['contracts'].append(d['contractHash'])
        return data
    replay=json.loads(Path(args.proposals).read_text()) if args.proposals else None
    def propose(i,accepted,dev):
        if replay is not None: return replay[i] if i<len(replay) else {}
        # Balanced bounded examples, plus predictions for error-focused discovery; no test data.
        baseline=sorted(set.intersection(*(set(r['features']) for r in rows if r['split']=='dev')))
        names=baseline+[c for n,q in accepted.items() for c in columns(n,q)]
        examples=feedback_examples(dev,names,cal)
        return transport({'mode':'propose','model':args.proposer_model,'accepted':accepted,'examples':examples})['questions']
    def features(batch,questions): return transport({'mode':'features','rows':batch,'questions':questions})['rows']
    def screen(question,examples): return transport({'mode':'screen','question':question,'examples':examples})['screening']
    result=discover(rows,propose,features,args.rounds,screen=screen)
    result['usage']={**ledger,'models':sorted(set(filter(None,ledger['models']))),'contracts':sorted(set(ledger['contracts']))}
    result['datasetSha256']=hashlib.sha256(Path(args.input).read_bytes()).hexdigest()
    result['labelSources']=sorted({r.get('labelSource','unspecified-input') for r in rows})
    result['featureObservations']=observations
    Path(args.output).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'questions':list(result['questions']),'test':result['test'],'usage':result['usage'],'deploy':False}))

if __name__=='__main__': main()
