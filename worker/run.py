#!/usr/bin/env python3
"""SDYnotes worker — 무거운 작업 전용 (127.0.0.1:5100).

Node(Fastify) 메인 서버가 /api/import/* 와 /api/music/* 의 무거운 경로를
여기로 프록시한다. importer.py(가져오기) 와 music.py(태깅·유튜브·인식) 는
원본 그대로 보존되어 있다.

  python3 worker/run.py            # 포트 5100 (SDY_WORKER_PORT 로 변경 가능)
"""
import os

from sdynotes_worker.core import app

# 로컬 라우트 등록 (cloud_routes 는 music_cloud 로 이관)
from sdynotes_worker import common  # noqa: F401  (상수/경로/락 초기화)
from sdynotes_worker import importer  # noqa: F401  (가져오기, 원본 그대로)
from sdynotes_worker import music     # noqa: F401  (음악 태깅/유튜브/인식, 원본 그대로)
from sdynotes_worker import extra     # noqa: F401  (play 로컬)
from sdynotes_worker import music_cloud  # noqa: F401  (클라우드 음악 변이 + 라우트 교체)

# 기동 시 죽은 변환 잡 정리
importer._imp_sweep_dead()

print(f"[boot] SDYnotes worker 기동 pid={os.getpid()}")

if __name__ == "__main__":
    port = int(os.environ.get("SDY_WORKER_PORT", "5100"))
    print("=" * 52)
    print(f"  SDYnotes {common.APP_VERSION} worker (가져오기·음악)")
    print(f"  127.0.0.1:{port} — 내부 전용")
    print("=" * 52)
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
