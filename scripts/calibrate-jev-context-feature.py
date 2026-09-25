"""Small, explicitly experimental calibration of a frozen Noul feature.

Development-only, held-out by behavior family; never activates runtime thresholds.
"""
import argparse
import importlib.util
import json
import subprocess
from pathlib import Path
import jev_calibration as calibration

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('context', Path(__file__).with_name('autoresearch-jev-context.py'))
context = importlib.util.module_from_spec(spec); spec.loader.exec_module(context)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for arg in ['dataset','artifact','feature','validation_group','output']: p.add_argument(arg)
    p.add_argument('--live', action='store_true')
    args = p.parse_args()
    if not args.live or Path(args.output).exists(): p.error('Explicit live and a new output required')
    data=json.loads(Path(args.dataset).read_text(encoding='utf-8'))
    episodes=context.validate(data,'dev')
    artifact=json.loads(Path(args.artifact).read_text(encoding='utf-8'))
    question=artifact['questions'][args.feature]
    if question['type']!='noul': p.error('Calibration target must be a Noul event')
    reviewed=[(e,r) for e in episodes for r in e['candidates'] if r['label'] is not None]
    payload={'mode':'features','questions':artifact['featureContracts'][args.feature],
        'rows':[context.feature_state(e,r,artifact.get('contextual',False)) for e,r in reviewed]}
    call=subprocess.run(['node','scripts/jev-research-transport.mjs'],input=json.dumps(payload),
        text=True,encoding='utf-8',capture_output=True,cwd=ROOT,timeout=300)
    if call.returncode: raise ValueError('Calibration measurements unavailable')
    measured=json.loads(call.stdout)
    contracts={d['contractHash'] for d in measured['diagnostics']}
    models={m for d in measured['diagnostics'] for m in d.get('models',[])}
    if len(contracts)!=1 or len(models)!=1: raise ValueError('Mixed judging contract')
    contract={'modelRequested':'typesafe/jev-1.13','modelObserved':next(iter(models)),
        'questions':payload['questions'],'evidenceFields':['query','candidate','selected'],
        'panel':'research','batchSize':1,'version':next(iter(contracts)),
        'languagePolicy':'Portuguese and English; source-grounded'}
    fingerprint=calibration.contract_hash(contract)
    rows=[{'group':e['group'],'split':'validation' if e['group']==args.validation_group else 'train',
        'label':r['label'],'score':v[args.feature],'contractHash':fingerprint,'labelSource':data['labelSource']}
        for (e,r),v in zip(reviewed,measured['rows'])]
    result=calibration.fit(rows,contract,min_train=20,min_validation=8)
    result['note']='Small DEV-family calibration only. Insufficient independent labels for production threshold promotion.'
    result['usage']={'cost':sum(d['cost'] for d in measured['diagnostics']),
        'requests':sum(d['requests'] for d in measured['diagnostics'])}
    Path(args.output).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'validation':result['validation'],'improved':result['improved'],'deploy':False}))


if __name__=='__main__':main()
