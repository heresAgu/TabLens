"""TabLens Score Pack & Delivery Pipeline

Packs an Agent v1 draft and manifest into tablens.agent.v2, runs automatic
verification via verify_agent_score.mjs, and delivers to the target destination.

Usage:
  python scripts/pack_and_deliver.py draft.agent.json manifest.json --output <target_path>
"""

import argparse
import json
from pathlib import Path
import subprocess
import sys

# Ensure project root and scripts dir are on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from scripts.pack_agent_source import pack
except ImportError:
    from pack_agent_source import pack


def main():
    if sys.stdout.encoding.lower() != 'utf-8':
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('draft', type=Path, help='tablens.agent.v1 JSON draft')
    parser.add_argument('manifest', type=Path, help='Manifest JSON with pages & measure regions')
    parser.add_argument('--output', '-o', type=Path, required=True, help='Destination path for final v2 JSON')
    args = parser.parse_args()

    draft_path = args.draft.resolve()
    manifest_path = args.manifest.resolve()
    output_path = args.output.resolve()

    print(f"📦 Loading draft: {draft_path.name}")
    draft_data = json.loads(draft_path.read_text(encoding='utf-8'))
    print(f"📋 Loading manifest: {manifest_path.name}")
    manifest_data = json.loads(manifest_path.read_text(encoding='utf-8'))

    # Pack into tablens.agent.v2
    print(f"🔄 Embedding WebP source pages and clipping regions...")
    v2_result = pack(draft_data, manifest_data, manifest_path.parent)

    # Ensure parent directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(v2_result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"💾 Written v2 JSON: {output_path} ({len(v2_result['sources'])} pages, {len(v2_result['measures'])} measures)")

    # Run verification via verify_agent_score.mjs
    verifier_script = Path(__file__).resolve().parent / 'verify_agent_score.mjs'
    if verifier_script.is_file():
        print(f"\n🔍 Running automated verification with TabLens engine...")
        proc = subprocess.run(['node', str(verifier_script), str(output_path)], capture_output=True, text=True)
        print(proc.stdout)
        if proc.stderr:
            print(proc.stderr, file=sys.stderr)
        if proc.returncode != 0:
            print(f"❌ Verification failed with code {proc.returncode}")
            sys.exit(proc.returncode)
    else:
        print(f"⚠️ Verifier script not found at {verifier_script}, skipping engine test.")

    print(f"🎉 Delivery complete: {output_path}\n")


if __name__ == '__main__':
    main()
