#!/usr/bin/env python3
"""Transcricao offline via faster-whisper (sem chave, sem custo).
Uso: transcribe_local.py <audio> [--model base] [--language pt] [--download-root models/stt]
Saida: JSON {"text": ..., "language": ..., "duration": ...} no stdout.
"""
import argparse
import json
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('audio')
    ap.add_argument('--model', default=os.environ.get('TRANSCRIBE_LOCAL_MODEL', 'base'))
    ap.add_argument('--language', default='pt')
    ap.add_argument('--download-root', default=os.environ.get('TRANSCRIBE_MODEL_DIR', 'models/stt'))
    args = ap.parse_args()

    if not os.path.exists(args.audio):
        print(json.dumps({'error': 'audio nao encontrado: %s' % args.audio}))
        return 2

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({'error': 'faster-whisper nao instalado (pip install faster-whisper)'}))
        return 3

    os.makedirs(args.download_root, exist_ok=True)
    try:
        model = WhisperModel(args.model, device='cpu', compute_type='int8', download_root=args.download_root)
        segments, info = model.transcribe(args.audio, language=args.language, beam_size=5)
        text = ''.join(s.text for s in segments).strip()
        print(json.dumps({'text': text, 'language': info.language, 'duration': round(info.duration, 1)}))
        return 0 if text else 4
    except Exception as e:
        print(json.dumps({'error': 'falha na transcricao: %s' % str(e)[:300]}))
        return 5


if __name__ == '__main__':
    sys.exit(main())
