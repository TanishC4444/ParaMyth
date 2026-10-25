"""Project-owned, normalized image uploads for Muse reference edits."""
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import secrets
import warnings

from .storage import save

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_REFERENCES = 3
MAX_PIXELS = 16_777_216


def reference_ids(raw):
    ids = raw.get('reference_ids', [])
    if (not isinstance(ids, list) or len(ids) > MAX_REFERENCES
            or any(not isinstance(i, str) or not re.fullmatch(r'[a-f0-9]{24}', i) for i in ids)
            or len(set(ids)) != len(ids)):
        raise ValueError('Choose up to three reference images from this project')
    return ids


def read_reference(folder, ident):
    reference_ids({'reference_ids': [ident]})
    root = Path(folder) / 'image-references'
    try:
        value = json.loads((root / (ident + '.json')).read_text(encoding='utf-8'))
        if value['id'] != ident or value['mime'] not in ('image/jpeg', 'image/png'):
            raise ValueError('Invalid reference image')
        extension = '.jpg' if value['mime'] == 'image/jpeg' else '.png'
        path = root / (ident + extension)
        if not path.is_file():
            raise ValueError('Reference image is missing')
        return value, path
    except (OSError, KeyError, TypeError, ValueError):
        raise ValueError('Reference image not found in this project. Upload it again or remove it.') from None


def list_references(folder):
    rows = []
    for path in sorted((Path(folder) / 'image-references').glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:100]:
        try:
            rows.append(read_reference(folder, path.stem)[0])
        except ValueError:
            continue
    return rows


def store_reference(folder, blob, name='Reference image'):
    if not blob or len(blob) > MAX_UPLOAD_BYTES:
        raise ValueError('Choose an image under 5 MB')
    from PIL import Image, ImageOps, UnidentifiedImageError
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(blob)) as source:
                if source.format not in ('JPEG', 'PNG', 'WEBP') or getattr(source, 'is_animated', False):
                    raise ValueError('Choose a still PNG, JPG or WebP image')
                if source.width * source.height > MAX_PIXELS:
                    raise ValueError('Choose an image with at most 16 megapixels')
                source.verify()
            with Image.open(io.BytesIO(blob)) as source:
                image = ImageOps.exif_transpose(source)
                image.thumbnail((2048, 2048))
                alpha = 'A' in image.getbands() or 'transparency' in image.info
                image = image.convert('RGBA' if alpha else 'RGB')
                # Clear EXIF, GPS, text and other metadata before saving/sending.
                image.info.clear()
                output = io.BytesIO()
                image.save(output, format='PNG' if alpha else 'JPEG', **({} if alpha else {'quality': 92}))
                normalized = output.getvalue()
                width, height = image.size
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError('This image could not be read. Choose a valid PNG, JPG or WebP.') from None
    if len(normalized) > 8 * 1024 * 1024:
        raise ValueError('This image is too large after processing. Choose a smaller image.')
    ident = secrets.token_hex(12)
    mime, extension = ('image/png', '.png') if alpha else ('image/jpeg', '.jpg')
    name = re.sub(r'[\x00-\x1f\x7f]', '', str(name).replace('\\', '/').rsplit('/', 1)[-1])[:150] or 'Reference image'
    value = {'id': ident, 'name': name, 'mime': mime, 'width': width, 'height': height,
             'bytes': len(normalized), 'sha256': hashlib.sha256(normalized).hexdigest()}
    root = Path(folder) / 'image-references'
    root.mkdir(parents=True, exist_ok=True)
    (root / (ident + extension)).write_bytes(normalized)
    save(root / (ident + '.json'), value)
    return value


def validate_references(folder, raw):
    ids = reference_ids(raw)
    if ids and raw.get('model') != 'muse-image-1.0':
        raise ValueError('Choose Muse Image to use reference images')
    return [read_reference(folder, ident)[0] for ident in ids]


def muse_input(folder, raw, prompt):
    references = validate_references(folder, raw)
    if not references:
        return prompt
    parts = [{'type': 'input_text', 'text': prompt}]
    for reference in references:
        _, path = read_reference(folder, reference['id'])
        blob = path.read_bytes()
        if hashlib.sha256(blob).hexdigest() != reference['sha256']:
            raise ValueError('Reference image changed. Upload it again before generating.')
        parts.append({'type': 'input_image', 'image_url': 'data:' + reference['mime'] + ';base64,' + base64.b64encode(blob).decode('ascii')})
    return [{'role': 'user', 'content': parts}]
