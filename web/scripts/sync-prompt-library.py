import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen


OUTPUT = Path(__file__).resolve().parent.parent / 'public' / 'prompt-library'
REGISTRY = 'yukkcat/image-prompts'
REVISION = 'e9b9473cfeb32b75109a486b9915b151558dfc5b'
MANIFEST_SHA = 'f5060766d172495a7e2ab5955b6f955c061ae9219354e0ee1517500fa0c5cbe9'
LOCAL_SOURCE = 'awesome-gpt4o-image-prompts'
LICENSE_OWNER = 'ImgEdify/Awesome-GPT4o-Image-Prompts'
LICENSE_REVISION = 'd45df616410164a464990081ca0050dd293913c2'
LICENSE_SHA = 'f8131f554150f4865eb43845e3148f3e75c6ed664a6b2326a00dfc7fc1a7b976'
ORIGINAL_JSON = {
    'banana-prompt-quicker': ('glidea/banana-prompt-quicker', '93c7997d11ad95b2280c0137adfc336850a501ca', 'title'),
    'davidwu-gpt-image2-prompts': ('davidwuw0811-boop/awesome-gpt-image2-prompts', '228edb6341d978aa2572911adf7e7e147ebf95d3', 'title_cn'),
}
SOURCES = {
    'banana-prompt-quicker', 'davidwu-gpt-image2-prompts', 'freestylefly-gpt-image-2',
    'awesome-gpt-image', LOCAL_SOURCE, 'youmind-gpt-image-2', 'youmind-nano-banana-pro',
}


def raw_url(repo, revision, path):
    return f'https://raw.githubusercontent.com/{repo}/{revision}/{path}'


def get_bytes(url, expected_hash=None):
    with urlopen(url) as response:
        content = response.read()
    if expected_hash and hashlib.sha256(content).hexdigest() != expected_hash:
        raise ValueError(f'SHA256 mismatch: {url}')
    return content


def https(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError(f'Expected a public HTTPS link: {value}')
    return value


def field_lines(content, field):
    pattern = re.compile(r'^\s*' + re.escape(json.dumps(field)) + r'\s*:')
    return [line for line, text in enumerate(content.decode().splitlines(), 1) if pattern.match(text)]


def entry_links(source, records, content):
    source_id = source['id']
    if source_id in ORIGINAL_JSON:
        repo, revision, title_key = ORIGINAL_JSON[source_id]
        original = get_bytes(raw_url(repo, revision, 'prompts.json'))
        base = f'https://github.com/{repo}/blob/{revision}/prompts.json'
        result = []
        for row, original_row, line in zip(records, json.loads(original), field_lines(original, title_key), strict=True):
            if row['title'].strip() != original_row[title_key].strip():
                raise ValueError(f'Original entry changed: {row["id"]}')
            result.append(f'{base}#L{line}')
        return result
    base = f'https://github.com/{REGISTRY}/blob/{REVISION}/dist/{source["path"]}'
    return [
        f'{base}#L{line}' if row['sourceUrl'] == source['homepage'] else https(row['sourceUrl'])
        for row, line in zip(records, field_lines(content, 'id'), strict=True)
    ]


def preview_link(source_id, url):
    if source_id == LOCAL_SOURCE and url.startswith('https://cdn.imgedify.com/'):
        return url
    banana = 'https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/images/'
    if source_id == 'banana-prompt-quicker' and url.startswith(banana):
        repo, revision, _ = ORIGINAL_JSON[source_id]
        filename = url.removeprefix(banana)
        corrected = {'afadan.png': 'afanda.png', 'afadan_ref1.jpg': 'afanda_ref1.jpg'}
        return raw_url(repo, revision, 'images/' + corrected.get(filename, filename))
    return ''


def catalog_file(source):
    source_id = source['id']
    if source['path'] != f'sources/{source_id}.json':
        raise ValueError(f'Unexpected registry path: {source_id}')
    url = raw_url(REGISTRY, REVISION, 'dist/' + source['path'])
    content = get_bytes(url, source['sha256'])
    records = json.loads(content)
    ids = {row['id'] for row in records}
    if len(records) != len(ids) or len(records) != source['count']:
        raise ValueError(f'Count or duplicate ID mismatch: {source_id}')
    mode = 'local' if source_id == LOCAL_SOURCE else 'remote'
    entries = []
    for row, link in zip(records, entry_links(source, records, content), strict=True):
        if row['sourceId'] != source_id or not row['id'].startswith(source_id + ':') or not row['prompt'].strip():
            raise ValueError(f'Invalid prompt: {row["id"]}')
        entry = {key: row[key] for key in ('id', 'title', 'author', 'tags', 'imageModel', 'imageMode', 'createdAt')}
        entry.update(sourceUrl=https(row['sourceUrl']), entryUrl=link, sourceMode=mode, prompt='')
        if mode == 'local':
            entry.update(prompt=row['prompt'], description=row['description'])
        if cover := preview_link(source_id, row['coverUrl']):
            entry['coverUrl'] = cover
        refs = [preview for url in row['referenceImageUrls'] if (preview := preview_link(source_id, url))]
        if refs:
            entry['referenceImageUrls'] = refs
        entries.append(entry)
    source_record = {key: source[key] for key in ('id', 'name', 'homepage', 'count', 'sha256')}
    source_record.update(nativeUrl=url, sourceMode=mode)
    if mode == 'local':
        source_record.update(license='MIT', licenseUrl=f'https://github.com/{LICENSE_OWNER}/blob/{LICENSE_REVISION}/LICENSE', licenseFile='LICENSE-ImgEdify.txt')
    rows = (json.dumps(entry, ensure_ascii=False, separators=(',', ':')) for entry in entries)
    return source_record, ('[\n' + ',\n'.join(rows) + '\n]\n').encode()


def build():
    manifest = json.loads(get_bytes(raw_url(REGISTRY, REVISION, 'dist/manifest.json'), MANIFEST_SHA))
    if manifest['schemaVersion'] != 1 or {source['id'] for source in manifest['sources']} != SOURCES:
        raise ValueError('Source membership or schema changed. Review the registry before syncing.')
    files = {'LICENSE-ImgEdify.txt': get_bytes(raw_url(LICENSE_OWNER, LICENSE_REVISION, 'LICENSE'), LICENSE_SHA)}
    sources = []
    for source in manifest['sources']:
        summary, files[source['id'] + '.json'] = catalog_file(source)
        sources.append(summary)
    if sum(source['count'] for source in sources) != manifest['total']:
        raise ValueError('Registry total mismatch')
    summary = {'schemaVersion': 1, 'registryCommit': REVISION, 'generatedAt': manifest['generatedAt'],
               'total': manifest['total'], 'sources': sources}
    files['manifest.json'] = (json.dumps(summary, ensure_ascii=False, indent=2) + '\n').encode()
    return files, summary


def main():
    parser = argparse.ArgumentParser(description='Sync the reviewed upstream image-prompt registry.')
    parser.add_argument('--check', action='store_true', help='Compare the checked-in snapshot to the pinned sources.')
    check = parser.parse_args().check
    files, manifest = build()
    if not check:
        OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        path = OUTPUT / name
        if path.is_file() and path.read_bytes() == content:
            continue
        if check:
            raise SystemExit(f'Prompt snapshot differs: {path}')
        temporary = path.with_suffix(path.suffix + '.new')
        temporary.write_bytes(content)
        temporary.replace(path)
    print(f'{len(manifest["sources"])} sources, {manifest["total"]} prompts, {sum(map(len, files.values()))} bytes')


if __name__ == '__main__':
    main()
