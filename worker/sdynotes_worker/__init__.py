"""SDYnotes worker package — heavy jobs (PDF import, music tagging/YouTube/AcoustID).

Node(Fastify) 메인 서버가 가벼운 API를 처리하고, 이 워커는 무거운 작업만
127.0.0.1:5100 에서 처리한다. importer.py / music.py 는 원본 그대로 보존.
"""
__version__ = "14.8.0"
