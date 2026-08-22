#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
서버 측 동시 편집(3-way) 병합 엔드포인트 회귀 테스트.
전제: Node 서버가 떠 있어야 한다 (로컬 폴백 or 클라우드 모드 무관).
  SDY_BASE 환경변수로 base URL 변경 가능 (기본 http://127.0.0.1:5000).

시나리오:
  1. 두 기기 동시 편집(같은 공통 조상) → 양쪽 편집 모두 보존
  2. 순차 편집 → 중복/유실 없음
  3. 한 기기 재편집(prevRev=자기 마지막 push) → 정확
  4. 3·4 기기 동시 편집 → 모두 보존
  5. 옛 클라이언트(prevRev 없음) → LWW 폴백 (수용, 최신값)
  6. 비텍스트 낡은 rev 거부 / 삭제 정상
"""
import json, os, re, sys, urllib.request, urllib.error

BASE = os.environ.get("SDY_BASE", "http://127.0.0.1:5000")
PASS = 0
FAIL = 0
# 서버는 nb 이름에서 비영숫자(- 제외)를 제거한 파일명으로 저장한다.
def _san(nb): return re.sub(r'[^0-9a-zA-Z-]', '', nb)

def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  \033[32m✓\033[0m " + name + (f"  {extra}" if extra else ""))
    else:
        FAIL += 1
        print("  \033[31m✗\033[0m " + name + (f"  {extra}" if extra else ""))

def push(nb, ops):
    data = json.dumps({"nb": nb, "ops": ops}).encode()
    req = urllib.request.Request(BASE + "/api/sync/push", data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")

def pull(nb):
    with urllib.request.urlopen(BASE + "/api/sync/pull?nb=%s&since=0" % nb, timeout=15) as r:
        return json.loads(r.read() or b"{}")

def boxhtml(nb, bid="box"):
    for o in pull(nb)["ops"]:
        if o["id"] == bid:
            return o.get("data", {}).get("html")
    return None

def tel(html, rev, prev, bid="box"):
    return {"id": bid, "kind": "put", "rev": rev, "prevRev": prev, "page": 0, "dev": "d_t",
            "data": {"id": bid, "type": "text", "x": 0, "y": 0, "w": 100, "h": 20, "html": html}}

def main():
    import uuid
    run = uuid.uuid4().hex[:8]   # 실행마다 고유 nb → 잔여 상태 오염 방지
    NB1, NB2, NB3, NB4, NB4b, NB5, NB6 = ["ce%d_%s" % (i, run) for i in range(1, 8)]

    print("═ 시나리오 1: 두 기기 동시 편집 → 서버 3-way 병합 ═")
    NB = NB1
    push(NB, [tel("hello", 1000, 0)])
    push(NB, [tel("hello A", 1001, 1000)])
    push(NB, [tel("hello B", 1002, 1000)])
    h = boxhtml(NB)
    ok("A 보존", "A" in h, h); ok("B 보존", "B" in h, h); ok("원문 보존", "hello" in h, h)

    print("═ 시나리오 2: 순차 편집(중복/유실 없음) ═")
    NB = NB2
    push(NB, [tel("hello", 1000, 0)])
    push(NB, [tel("hello A", 1001, 1000)])
    push(NB, [tel("hello A!", 1003, 1001)])
    h = boxhtml(NB)
    ok("'hello A!' 1회", h == "hello A!", repr(h))

    print("═ 시나리오 3: 한 기기 재편집(prevRev=자기 push) ═")
    NB = NB3
    push(NB, [tel("abc", 1000, 0)])
    push(NB, [tel("abcX", 1001, 1000)])
    push(NB, [tel("abcXY", 1002, 1001)])
    h = boxhtml(NB)
    ok("'abcXY' 정확", h == "abcXY", repr(h))

    print("═ 시나리오 4: 3·4 기기 동시 편집 ═")
    NB = NB4
    push(NB, [tel("x", 1000, 0)])
    for rev, c in [(1001, "1"), (1002, "2"), (1003, "3")]:
        push(NB, [tel("x" + c, rev, 1000)])
    h = boxhtml(NB)
    ok("3기기 모두 보존", all(c in h for c in "123"), h)
    NB = NB4b
    push(NB, [tel("y", 1000, 0)])
    for rev, c in [(1001, "1"), (1002, "2"), (1003, "3"), (1004, "4")]:
        push(NB, [tel("y" + c, rev, 1000)])
    h = boxhtml(NB)
    ok("4기기 모두 보존", all(c in h for c in "1234"), h)

    print("═ 시나리오 5: 옛 클라이언트(prevRev 없음) LWW 폴백 ═")
    NB = NB5
    push(NB, [tel("base", 1000, 0)])
    push(NB, [tel("baseA", 1001, 1000)])
    st, d = push(NB, [{"id": "box", "kind": "put", "rev": 9000, "data": {"id": "box", "type": "text", "html": "plain"}}])
    ok("prevRev 없이 수용", st == 200 and d.get("accepted") == ["box"], str(d))
    ok("LWW 최신값", boxhtml(NB) == "plain", boxhtml(NB))

    print("═ 시나리오 6: 비텍스트·삭제 기존 동작 ═")
    NB = NB6
    push(NB, [{"id": "s1", "kind": "put", "rev": 1000, "data": {"id": "s1", "type": "stroke", "pts": [[0, 0]]}}])
    st, d = push(NB, [{"id": "s1", "kind": "put", "rev": 999, "data": {"id": "s1", "type": "stroke", "pts": [[9, 9]]}}])
    ok("비텍스트 낡은 rev 거부", "s1" in d.get("rejected", []), str(d))
    push(NB, [tel("base", 1000, 0)])
    st, d = push(NB, [{"id": "box", "kind": "del", "rev": 9500}])
    ok("삭제 수용·반영", d.get("accepted") == ["box"] and boxhtml(NB) is None)

    print("\n\033[1m서버 협업 병합: PASS %d / FAIL %d\033[0m" % (PASS, FAIL))

    # 로컬 폴백 모드 잔여 sync 파일 정리 (실패해도 무시)
    for f in [NB1, NB2, NB3, NB4, NB4b, NB5, NB6]:
        for suffix in [".json", ".meta"]:
            try: os.remove(os.path.join("sync", _san(f) + suffix))
            except Exception: pass
    try: os.rmdir("sync")
    except Exception: pass

    sys.exit(0 if FAIL == 0 else 1)

if __name__ == "__main__":
    main()
