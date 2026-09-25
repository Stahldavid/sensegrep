"""Freeze a bounded whole-symbol measurement pool without truncating source.

Apply the same limit to development and reserved data before feature calls.
Original baselines remain recorded; sameSelectorLocal is the equal-pool control.
"""
import argparse
import hashlib
import json
from pathlib import Path


def prepare(data, limit=12000):
    if limit < 1 or limit > 24000:
        raise ValueError('Whole-symbol limit must fit the Jev candidate bound')
    removed = 0
    for episode in data['episodes']:
        original = episode['candidates']
        episode['candidates'] = [r for r in original if r['complete'] and len(r['candidate']['content']) <= limit]
        removed += len(original) - len(episode['candidates'])
        # Missing gold remains missing; no label-dependent retention.
    data['measurementFilter'] = {'maxSourceCharacters': limit, 'excluded': removed,
        'reason': 'Complete symbols only; no truncated model training inputs'}
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input'); parser.add_argument('output')
    parser.add_argument('--max-source-characters', type=int, default=12000)
    args = parser.parse_args()
    target = Path(args.output)
    if target.exists(): parser.error('Refuse to overwrite a frozen dataset')
    raw = Path(args.input).read_bytes()
    result = prepare(json.loads(raw), args.max_source_characters)
    result['measurementSourceSha256'] = hashlib.sha256(raw).hexdigest()
    target.write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result['measurementFilter']))
