#!/usr/bin/env bash
set -euo pipefail
: "${RELAY_URL:?Set RELAY_URL}"
: "${BOT_TOKEN:?Set BOT_TOKEN}"
command -v jq >/dev/null
RELAY_URL=${RELAY_URL%/}
request() { local method=$1 path=$2; shift 2; curl --fail-with-body --silent --show-error -X "$method" "$RELAY_URL$path" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' "$@"; }
original=$(request GET /state)
pairing=$(request POST /pairings -d '{}')
enrollment=$(curl --fail-with-body --silent --show-error "$RELAY_URL/register" -H 'Content-Type: application/json' -d "$(jq -n --arg code "$(jq -r .code <<<"$pairing")" '{pairingCode:$code,name:"Smoke test (disposable)"}')")
device_id=$(jq -r .deviceId <<<"$enrollment")
device_secret=$(jq -r .secret <<<"$enrollment")
page_id="smoke-$(date +%s)"
page_removed=false
widget_removed=false
cleanup() {
 local current
 current=$(request GET /state) || true
 if [[ -n "${current:-}" ]]; then
  request POST /state -d "$(jq -n --argjson original "$original" --argjson revision "$(jq .revision <<<"$current")" '{mode:"replace",revision:$revision,state:($original|del(.revision,.updatedAt))}')" >/dev/null || true
 fi
 request DELETE "/devices/$device_id" >/dev/null || true
 if [[ "$page_removed" == false ]]; then request DELETE "/pages/$page_id" >/dev/null || true; fi
 if [[ "$widget_removed" == false ]]; then request DELETE "/widgets/$page_id?revision=1" >/dev/null || true; fi
}
trap cleanup EXIT
device_request() { local method=$1 path=$2; shift 2; curl --fail-with-body --silent --show-error -X "$method" "$RELAY_URL$path" -H "Authorization: Bearer $device_secret" -H "X-Device-ID: $device_id" -H 'Content-Type: application/json' "$@"; }
device_request POST /register -d '{"tokens":{}}' | jq -e .registered >/dev/null
device_request GET /state | jq -e '.schemaVersion == 1' >/dev/null
request POST /state -d "$(jq -n --argjson revision "$(jq .revision <<<"$original")" '{mode:"patch",revision:$revision,state:{blocks:[{id:"smoke",type:"text",text:"Relay smoke test"}]}}')" | jq -e .state >/dev/null
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
request POST /widget -d "$(jq -n --arg stamp "$stamp" '{kind:"botCard",data:{title:"Smoke test",body:"Relay is reachable",timestamp:$stamp}}')" | jq -e '.status == "queued"' >/dev/null
request POST /widget -d "$(jq -n --arg id "$page_id" --arg stamp "$stamp" '{id:$id,name:"Smoke named card",revision:0,kind:"botCard",data:{title:"Named smoke",body:"Independent content",timestamp:$stamp}}')" | jq -e '.revision == 1' >/dev/null
device_request GET /widgets | jq -e --arg id "$page_id" '[.widgets[]|select(.id==$id)]|length==1' >/dev/null
device_request GET '/state?widgets=1' | jq -e --arg id "$page_id" '[.widgetInstances[]|select(.id==$id)]|length==1' >/dev/null
request DELETE "/widgets/$page_id?revision=1" | jq -e .deleted >/dev/null
widget_removed=true
request POST /notify -d "$(jq -n --arg device "$device_id" '{deviceId:$device,title:"Smoke test",body:"No push token on disposable test device"}')" | jq -e .jobs >/dev/null
request POST /pages -d "$(jq -n --arg id "$page_id" '{id:$id,title:"Smoke page",markdown:"Hello from smoke"}')" | jq -e --arg id "$page_id" '.id == $id' >/dev/null
device_request GET "/pages/$page_id" | jq -e '.markdown == "Hello from smoke"' >/dev/null
request GET /pages | jq -e --arg id "$page_id" '[.pages[]|select(.id==$id)]|length==1' >/dev/null
request POST /notify -d "$(jq -n --arg device "$device_id" --arg page "$page_id" '{deviceId:$device,title:"Smoke page",body:"Open the reminder",pageId:$page}')" | jq -e .jobs >/dev/null
report=$(device_request GET "/pages/$page_id?feedback=1")
feedback_id=$(node -e 'console.log(crypto.randomUUID())')
device_request POST /feedback -d "$(jq -n --arg id "$feedback_id" --arg page "$page_id" --arg version "$(jq -r .updatedAt <<<"$report")" '{id:$id,pageId:$page,pageUpdatedAt:$version,text:"Smoke feedback"}')" | jq -e .accepted >/dev/null
request GET /actions | jq -e --arg id "$feedback_id" '[.actions[]|select(.id==$id and .actionId=="report-feedback")]|length==1' >/dev/null
request DELETE "/pages/$page_id" | jq -e .deleted >/dev/null
page_removed=true
id=$(node -e 'console.log(crypto.randomUUID())')
payload=$(jq -n --arg id "$id" --arg stamp "$stamp" '{id:$id,actionId:"smoke",source:"widget",timestamp:$stamp}')
device_request POST /action -d "$payload" | jq -e .accepted >/dev/null
device_request POST /action -d "$payload" >/dev/null
request GET /actions | jq -e --arg id "$id" '[.actions[]|select(.id==$id)]|length==1' >/dev/null
# A paired device without an ActivityKit token must fail explicitly, not pretend to start.
code=$(curl --silent --output /dev/null --write-out '%{http_code}' "$RELAY_URL/activity" -H "Authorization: Bearer $BOT_TOKEN" -H 'Content-Type: application/json' -d "$(jq -n --arg d "$device_id" '{deviceId:$d,event:"start",activityId:"smoke",content:{title:"Smoke",status:"Testing",progress:0}}')")
[[ "$code" == 409 ]]
request GET /devices | jq -e .devices >/dev/null
request GET /deliveries | jq -e .deliveries >/dev/null
printf 'PASS: relay routes, pairing, auth, state, widgets, pages, actions, activity precondition. Physical push tests remain separate.\n'
