"""Monotone event-probability calibration with an exact, versioned judging contract.
This is separate from feature selection; concentration is never treated as correctness.
"""
import argparse
import bisect
import hashlib
import json
import math
from pathlib import Path


def contract_hash(contract):
    required={'modelRequested','modelObserved','questions','evidenceFields','panel','batchSize','version','languagePolicy'}
    if not isinstance(contract,dict) or not required.issubset(contract) or any(contract[k] is None for k in required):
        raise ValueError('Incomplete judging contract')
    return hashlib.sha256(json.dumps(contract,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode()).hexdigest()


def isotonic(rows):
    # Aggregate ties before PAVA so equal scores cannot get different fitted values.
    groups={}
    for r in rows:
        total,count=groups.get(r['score'],(0,0));groups[r['score']]=(total+r['label'],count+1)
    blocks=[]
    for x,(total,count) in sorted(groups.items()):
        blocks.append({'xs':[x],'sum':total,'n':count})
        while len(blocks)>1 and blocks[-2]['sum']/blocks[-2]['n']>blocks[-1]['sum']/blocks[-1]['n']:
            b=blocks.pop();a=blocks[-1];a['xs']+=b['xs'];a['sum']+=b['sum'];a['n']+=b['n']
    return [[x,b['sum']/b['n']] for b in blocks for x in b['xs']]


def apply_artifact(artifact, scores, contract):
    if artifact.get('schemaVersion')!=1 or artifact.get('contractHash')!=contract_hash(contract):
        raise ValueError('Calibration contract changed; refit required')
    knots=artifact.get('knots',[])
    if not knots or any(len(k)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=1 for v in k) for k in knots):
        raise ValueError('Invalid calibration knots')
    if any(a[0]>=b[0] or a[1]>b[1] for a,b in zip(knots,knots[1:])): raise ValueError('Non-monotone calibration')
    xs=[k[0] for k in knots];out=[]
    for score in scores:
        if not isinstance(score,(int,float)) or not math.isfinite(score) or not 0<=score<=1: raise ValueError('Invalid score')
        i=bisect.bisect_left(xs,score)
        if i==0: value=knots[0][1]
        elif i==len(knots): value=knots[-1][1]
        else:
            a,b=knots[i-1],knots[i];value=a[1]+(b[1]-a[1])*(score-a[0])/(b[0]-a[0])
        out.append(value)
    return out


def metrics(labels, scores):
    n=len(labels)
    bins=[]
    for i in range(10):
        indices=[j for j,p in enumerate(scores) if min(9,int(p*10))==i]
        if indices: bins.append({'count':len(indices),'predicted':sum(scores[j] for j in indices)/len(indices),'observed':sum(labels[j] for j in indices)/len(indices)})
    return {'brier':sum((y-p)**2 for y,p in zip(labels,scores))/n,
        'logLoss':-sum(y*math.log(max(1e-9,p))+(1-y)*math.log(max(1e-9,1-p)) for y,p in zip(labels,scores))/n,
        'ece':sum(b['count']*abs(b['predicted']-b['observed']) for b in bins)/n,'bins':bins}


def fit(rows, contract, min_train=100, min_validation=20):
    fingerprint=contract_hash(contract)
    if any(r.get('split') not in ('train','validation') or r.get('label') not in (0,1) or not r.get('group')
           or not r.get('labelSource') or not isinstance(r.get('score'),(int,float)) or not math.isfinite(r['score']) or not 0<=r['score']<=1
           or r.get('contractHash')!=fingerprint for r in rows): raise ValueError('Labels, provenance, matching contract and finite scores required')
    train=[r for r in rows if r['split']=='train'];validation=[r for r in rows if r['split']=='validation']
    if len(train)<min_train or len(validation)<min_validation: raise ValueError('Insufficient labelled samples')
    if {r['group'] for r in train}&{r['group'] for r in validation}: raise ValueError('Group leakage')
    if any({r['label'] for r in rs}!={0,1} for rs in [train,validation]): raise ValueError('Both classes required in each partition')
    artifact={'schemaVersion':1,'contract':contract,'contractHash':fingerprint,'knots':isotonic(train),'deploy':False,
        'labelSources':sorted({r['labelSource'] for r in rows}),'trainRows':len(train),'validationRows':len(validation)}
    labels=[r['label'] for r in validation];scores=[r['score'] for r in validation]
    artifact['validation']={'raw':metrics(labels,scores),'calibrated':metrics(labels,apply_artifact(artifact,scores,contract))}
    artifact['improved']=artifact['validation']['calibrated']['brier']<artifact['validation']['raw']['brier']
    return artifact


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('contract');p.add_argument('output');args=p.parse_args()
    result=fit(json.loads(Path(args.input).read_text()),json.loads(Path(args.contract).read_text()))
    Path(args.output).write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'improved':result['improved'],'validation':result['validation'],'deploy':False}))
