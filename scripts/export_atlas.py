"""Export the story atlas from data/literary_rag.db for the frontend-pipeline's offline fallback.

    python -m scripts.export_atlas

The frontend-pipeline reads /api/v1/atlas when a studio API is reachable and this bundled
copy otherwise. Re-run after rebuilding the RAG index or editing data/atlas-places.json.
"""
import json
from pathlib import Path

from paramyth.pipeline.api.atlas import load_stories

OUT = Path(__file__).resolve().parents[1] / 'frontend-pipeline' / 'public' / 'atlas' / 'stories.json'
INDEX = OUT.parents[2] / 'src' / 'atlas-index.json'


def index_snapshot(data):
    fields=('id','title','tradition','section','attribution','region','place','basis','lat','lng','mechanism','themes','teaser','detailed','episodes')
    return {**data,'stories':[{key:story[key] for key in fields} for story in data['stories']]}


def snapshot() -> dict:
    corpus, stories = load_stories()
    return {'corpus': corpus, 'regions': sorted({s.region for s in stories}), 'stories': [s.model_dump() for s in stories]}


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    data=snapshot()
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n',encoding='utf-8')
    INDEX.write_text(json.dumps(index_snapshot(data),ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(f'Wrote {OUT}')


if __name__ == '__main__':
    main()
