import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const stylesPath = fs.existsSync(path.resolve(process.cwd(), "src/styles.css"))
  ? path.resolve(process.cwd(), "src/styles.css")
  : path.resolve(process.cwd(), "apps/command-ui-react/src/styles.css");
const stylesText = fs.readFileSync(stylesPath, "utf8");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("React command center", () => {
  it("renders the incident feed from API data", async () => {
    mockFetch();
    render(<App />);

    expect((await screen.findAllByText("VIRTUAL FENCE INTRUSION")).length).toBeGreaterThan(0);
    expect(screen.getByText("cam-bop-01-east / zone-east-fence")).toBeInTheDocument();
    expect(screen.getByText("BOP 01 East Gate Camera")).toBeInTheDocument();
  });

  it("posts the acknowledge action to the existing backend route", async () => {
    const fetchMock = mockFetch();
    render(<App />);

    await screen.findAllByText("VIRTUAL FENCE INTRUSION");
    fireEvent.change(screen.getByPlaceholderText("Optional note"), { target: { value: "Verified by operator" } });
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/incidents/inc-001/acknowledge", expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ note: "Verified by operator", target: "sector-command" })
      }));
    });
  });

  it("renders honest evidence unavailable state when no clip exists", async () => {
    mockFetch({ evidence: [{ ...evidenceManifest, assets: evidenceManifest.assets.slice(0, 1), metadata: { clipReasonCodes: ["ROLLING_BUFFER_EMPTY"] } }] });
    render(<App />);

    expect(await screen.findByText("Evidence unavailable: ROLLING_BUFFER_EMPTY")).toBeInTheDocument();
  });

  it("keeps the topbar outside the scrollable incident content", async () => {
    const incidents = buildIncidents(60);
    mockFetch({
      incidents,
      metrics: {
        ...baseData.metrics,
        incidents: { total: incidents.length, open: incidents.length, bySeverity: { HIGH: incidents.length }, sla: { overdue: 0 } }
      }
    });
    const { container } = render(<App />);

    await screen.findAllByText("VIRTUAL FENCE INTRUSION");

    const shell = container.querySelector(".shell");
    const topbar = container.querySelector(".topbar");
    const scrollRegion = container.querySelector(".scroll-region");
    expect(shell).toBeInTheDocument();
    expect(topbar).toBeInTheDocument();
    expect(scrollRegion).toBeInTheDocument();
    expect(scrollRegion?.contains(topbar)).toBe(false);

    expect(stylesText).toMatch(/html,\s*body,\s*#root\s*{[^}]*overflow:\s*hidden/s);
    expect(stylesText).toMatch(/\.shell\s*{[^}]*position:\s*fixed[^}]*overflow:\s*hidden/s);
    expect(stylesText).toMatch(/\.topbar\s*{[^}]*position:\s*sticky/s);
    expect(stylesText).toMatch(/\.scroll-region\s*{[^}]*overflow-y:\s*auto/s);

    fireEvent.scroll(scrollRegion as Element, { target: { scrollTop: 2400 } });
    expect(topbar).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("scrolls the incident detail panel into view when an incident is selected", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = (Element.prototype as { scrollIntoView?: Element["scrollIntoView"] }).scrollIntoView;
    (Element.prototype as { scrollIntoView?: Element["scrollIntoView"] }).scrollIntoView = scrollIntoView;

    try {
      const incidents = buildIncidents(3);
      mockFetch({ incidents });
      render(<App />);

      await screen.findAllByText("VIRTUAL FENCE INTRUSION");
      fireEvent.click(screen.getByRole("button", { name: /inc-002/i }));

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    } finally {
      (Element.prototype as { scrollIntoView?: Element["scrollIntoView"] }).scrollIntoView = originalScrollIntoView;
    }
  });
});

function mockFetch(overrides: Partial<MockData> = {}) {
  const data = { ...baseData, ...overrides };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/events") {
      return jsonResponse({}, { ok: false, status: 503, body: null });
    }
    if (url === "/health") return jsonResponse(data.health);
    if (url === "/api/cameras") return jsonResponse(data.cameras);
    if (url === "/api/zones") return jsonResponse(data.zones);
    if (url === "/api/incidents") return jsonResponse(data.incidents);
    if (url === "/api/evidence/manifests") return jsonResponse(data.evidence);
    if (url === "/api/audit") return jsonResponse(data.audit);
    if (url === "/api/metrics") return jsonResponse(data.metrics);
    if (url === "/api/incidents/inc-001/acknowledge" && init?.method === "POST") {
      return jsonResponse({ ...incident, status: "ACKNOWLEDGED" });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return fetchMock;
}

function jsonResponse(payload: unknown, overrides: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    body: {},
    json: async () => payload,
    ...overrides
  } as Response;
}

interface MockData {
  health: typeof baseData.health;
  cameras: typeof baseData.cameras;
  zones: typeof baseData.zones;
  incidents: typeof baseData.incidents;
  evidence: typeof baseData.evidence;
  audit: typeof baseData.audit;
  metrics: typeof baseData.metrics;
}

const incident = {
  incidentId: "inc-001",
  cameraId: "cam-bop-01-east",
  zoneId: "zone-east-fence",
  type: "VIRTUAL_FENCE_INTRUSION",
  severity: "HIGH",
  confidence: 0.91,
  status: "OPEN",
  captureTime: "2026-08-28T08:00:00.000Z",
  evidence: { manifestId: "manifest-001", sha256: "abcdef1234567890abcdef1234567890" },
  model: { name: "yolo", version: "v8n" },
  rule: { id: "virtual-fence", version: "default.zone.v1", reasonCodes: ["LINE_CROSSED"] }
};

const evidenceManifest = {
  manifestId: "manifest-001",
  incidentId: "inc-001",
  status: "VERIFIED",
  sha256: "abcdef1234567890abcdef1234567890",
  assetCount: 2,
  assets: [
    { kind: "KEYFRAME", sha256: "framehash", contentType: "image/jpeg", assetUrl: "/api/evidence/assets/manifest-001/0" },
    { kind: "CLIP", sha256: "cliphash", contentType: "video/mp4", assetUrl: "/api/evidence/assets/manifest-001/1" }
  ],
  metadata: { evidenceMode: "REAL_FRAME_KEYFRAME" }
};

function buildIncidents(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ...incident,
    incidentId: `inc-${String(index + 1).padStart(3, "0")}`,
    captureTime: new Date(Date.UTC(2026, 7, 28, 8, index, 0)).toISOString(),
    evidence: { ...incident.evidence, manifestId: `manifest-${String(index + 1).padStart(3, "0")}` }
  }));
}

const baseData = {
  health: { status: "ok", service: "control-api", time: "2026-08-28T08:00:01.000Z" },
  cameras: [{ cameraId: "cam-bop-01-east", name: "BOP 01 East Gate Camera", location: "East perimeter", status: "ONLINE" }],
  zones: [{ zoneId: "zone-east-fence", cameraId: "cam-bop-01-east", name: "East virtual fence" }],
  incidents: [incident],
  evidence: [evidenceManifest],
  audit: [{ schemaVersion: "audit-event.v1", auditId: "aud-001", actor: "cam-bop-01-east", action: "incident.created", resource: "inc-001", createdAt: "2026-08-28T08:00:02.000Z" }],
  metrics: {
    cameras: { total: 1, online: 1 },
    incidents: { total: 1, open: 1, bySeverity: { HIGH: 1 }, sla: { overdue: 0 } },
    evidence: { verified: 1, expired: 0 },
    audit: { total: 1 }
  }
};
