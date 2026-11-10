// Exercise the actual shared Swift decoder/selection code on hosted macOS.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const source = readFileSync('app/modules/agent-native/ios/AgentShared.swift', 'utf8');
const models = source.slice(source.indexOf('struct AgentCard:'), source.indexOf('enum AgentError:'));
const fixture = {
  schemaVersion: 1, revision: 5, updatedAt: '2026-11-09T00:00:00Z',
  widgets: {
    botCard: { title: 'Default', body: 'Original', timestamp: '2026-11-09T00:00:00Z' },
    metric: { label: 'Default', value: '1', color: '#123456' },
    buttonGrid: { buttons: [{ id: 'default-action', label: 'Default' }] },
  },
  widgetInstances: [
    { id: 'card-a', name: 'First', kind: 'botCard', data: { title: 'First', body: 'One', timestamp: '2026-11-09T00:00:00Z', pageId: 'page-a' } },
    { id: 'card-b', name: 'Second', kind: 'botCard', data: { title: 'Second', body: 'Two', timestamp: '2026-11-09T00:00:00Z', pageId: 'page-b' } },
    { id: 'chart-a', name: 'Revenue', kind: 'chart', data: { title: 'Revenue', unit: 'USD', color: '#123456', points: [{ label: 'Mon', value: 12 }], pageId: 'chart-page-a' } },
    { id: 'chart-b', name: 'Hours', kind: 'chart', data: { title: 'Hours', unit: 'h', color: '#123456', points: [{ label: 'Mon', value: 7 }], pageId: 'chart-page-b' } },
    { id: 'metric-a', name: 'Count', kind: 'metric', data: { label: 'Count', value: '42', color: '#123456' } },
    { id: 'grid-a', name: 'Controls', kind: 'buttonGrid', data: { buttons: [{ id: 'specific-action', label: 'Run' }] } },
  ],
};
const tests = `
let data = Data(##"${JSON.stringify(fixture)}"##.utf8)
let snapshot = try JSONDecoder().decode(AgentSnapshot.self, from: data)
assert(snapshot.selecting(nil, kind: "botCard")?.widgets.botCard.title == "Default")
assert(snapshot.selecting("__default__", kind: "botCard")?.widgets.botCard.title == "Default")
assert(snapshot.selecting("card-a", kind: "botCard")?.widgets.botCard.pageId == "page-a")
assert(snapshot.selecting("card-b", kind: "botCard")?.widgets.botCard.body == "Two")
assert(snapshot.selecting("chart-a", kind: "chart")?.widgets.chart?.points.first?.value == 12)
assert(snapshot.selecting("chart-b", kind: "chart")?.widgets.chart?.pageId == "chart-page-b")
assert(snapshot.selecting("metric-a", kind: "metric")?.widgets.metric.value == "42")
assert(snapshot.selecting("grid-a", kind: "buttonGrid")?.widgets.buttonGrid.buttons.first?.id == "specific-action")
assert(snapshot.selecting("card-a", kind: "chart") == nil)
assert(snapshot.selecting("deleted", kind: "botCard") == nil)
assert(snapshot.widgets.botCard.title == "Default")
var old = try JSONSerialization.jsonObject(with: data) as! [String: Any]
old.removeValue(forKey: "widgetInstances")
let legacy = try JSONDecoder().decode(AgentSnapshot.self, from: JSONSerialization.data(withJSONObject: old))
assert(legacy.selecting(nil, kind: "botCard")?.widgets.botCard.body == "Original")
assert(legacy.selecting("card-a", kind: "botCard") == nil)
print("PASS: native legacy decoding, independent cards/charts/metrics/grids, detail links, missing/wrong-kind selection")
`;
const directory = mkdtempSync(join(tmpdir(), 'noticeboard-selection-'));
try {
  const file = join(directory, 'Selection.swift');
  writeFileSync(file, `import Foundation\n${models}\n${tests}`);
  execFileSync('swift', [file], { stdio: 'inherit' });
} finally { rmSync(directory, { recursive: true, force: true }); }
