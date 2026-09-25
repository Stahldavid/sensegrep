"""Validate frozen research weights on a different repository; no training or selection."""
import json
import hashlib
import importlib.util
import subprocess
import sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('cal',Path('scripts/calibrate-jev.py'))
cal=importlib.util.module_from_spec(spec);spec.loader.exec_module(cal)
rows=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
artifact=json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
run=subprocess.run(['node','scripts/jev-research-transport.mjs'],input=json.dumps({'mode':'features',
    'rows':[{k:r[k] for k in ('query','candidate')} for r in rows],'questions':artifact['questions']}),
    text=True,encoding='utf-8',capture_output=True,timeout=900)
if run.returncode:raise RuntimeError('External feature evaluation failed')
data=json.loads(run.stdout)
if len(data['rows'])!=len(rows):raise ValueError('Row count mismatch')
for r,values in zip(rows,data['rows']):r['features'].update(values)
predicted=cal.predict(artifact['model'],rows)
# The frozen selected model is compared with raw local scores, not a newly fitted baseline.
result={'deploy':False,'rows':len(rows),'repositories':sorted({r['repository'] for r in rows}),
    'frozenArtifactSha256':hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest(),
    'datasetSha256':hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),
    'labelSources':sorted({r['labelSource'] for r in rows}),
    'frozenSelected':cal.metrics([r['label'] for r in rows],predicted),
    'rawLocal':cal.metrics([r['label'] for r in rows],[r['features']['localScore'] for r in rows]),
    'cost':sum(d['cost'] for d in data['diagnostics']),
    'models':sorted({m for d in data['diagnostics'] for m in d['models']}),
    'note':'No fitting on external labels. Raw local score is an uncalibrated comparison, not the original fitted baseline.'}
Path(sys.argv[3]).write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
