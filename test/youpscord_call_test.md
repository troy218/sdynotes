# 엽스코드 통화 점검 기록

작성일: 2026-08-23

## 확인한 코드 경로

- 프론트 릴레이: `sdynotes.html`
  - `/api/chat/voice-ws` WebSocket (16kHz μ-law)
  - 마이크 캡처(AudioWorklet, ScriptProcessor 폴백)
  - 음소거 · 말하는 중 표시 · 재접속 · 입장/퇴장 TTS · BGM
- 서버 릴레이: `server/src/routes/chat.js`
  - `/api/chat/config` → `{ok:true, voice:'relay'}`
  - `/api/chat/voice-ws` 프레임 중계 + ping/pong
  - `/api/chat/voice` · `/api/chat/leave` 가 음성 소켓을 닫음
  - `/api/chat/stream` SSE (채팅/노크/presence)
- 배포: `apply.sh`
  - nginx `location /api/chat/voice-ws` Upgrade
    (기존 site 파일이 있어도 `scripts/ensure_nginx_voice_ws.py` 로 보강)
  - coturn / TURN 포트 / `SDY_TURN_*` 를 새로 깔거나 쓰지 않음

WebRTC mesh · TURN/STUN · `/api/chat/signal` · `/api/chat/diag` ·
설정 토글(P2P 되돌리기)은 제거됐다.

## 실행한 테스트

```bash
node --check server/src/routes/chat.js
node --check server/src/index.js
bash -n apply.sh
npm run test:call
node test/tuning_one_action_contract.mjs
```

기대:

- 입장 · 메시지 · 파일 · SSE pending 큐 · knock · TTL 초기화
- 음성 WS welcome/join/leave · 프레임 릴레이 · mute · ping/pong
- leave / voice-off 가 소켓을 닫음
- 프론트에 `RTCPeerConnection` / `YPS.relay` 없음
- nginx Upgrade 경로가 `apply.sh` 에 있음

## 실제 서버에서 확인할 명령

```bash
curl -s 'http://127.0.0.1:5000/api/chat/config?uid=diag-client'
# {"ok":true,"voice":"relay"}
grep -n 'location /api/chat/voice-ws' /etc/nginx/sites-available/memo
```

외부 통화를 위해 Oracle VCN/NSG에 TURN 포트를 열 필요는 없다.
웹 마이크는 HTTPS(또는 localhost)에서만 열린다.

## 참고

이 저장소의 샌드박스에서는 두 브라우저의 실제 마이크 왕복 지연까지는
측정하지 않는다. 최종 확인은 HTTPS 사이트에서 두 기기로 마이크를 켜
`/api/chat/voice-ws` 가 101 인지 보면 된다.
