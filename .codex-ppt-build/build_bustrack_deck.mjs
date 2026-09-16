import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const workspaceDir = "C:\\Users\\USER\\Downloads\\Bus track\\bus-tracker";
const SKILL_DIR = "C:\\Users\\USER\\.codex\\plugins\\cache\\openai-primary-runtime\\presentations\\26.905.11957\\skills\\presentations";
const TMP_DIR = path.join(workspaceDir, ".codex-ppt-build");
const FINAL_PPTX = path.join(workspaceDir, "artifacts", "BusTrack_Entrepreneurship_Introduction.pptx");
const RUNTIME_PYTHON = "C:\\Users\\USER\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
process.env.RUNTIME_NODE = "C:\\Users\\USER\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\bin\\node.exe";
process.env.RUNTIME_NODE_MODULES = "C:\\Users\\USER\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
process.env.RUNTIME_BIN_DIR = "C:\\Users\\USER\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\bin\\override";

const { finalizePresentation } = await import(pathToFileURL(
  path.join(SKILL_DIR, "container_tools", "artifact_tool_utils.mjs"),
).href);

const W = 1280;
const H = 720;
const COLORS = {
  navy: "#06172D",
  navy2: "#0B2747",
  navy3: "#12385F",
  cyan: "#3AD6FF",
  cyanSoft: "#9EEBFF",
  violet: "#806BFF",
  green: "#43E1A1",
  amber: "#FFBD4A",
  red: "#FF7383",
  white: "#F5FAFF",
  muted: "#A9C1D3",
  dim: "#6E8AA0",
  grid: "#214360",
};
const TITLE_FONT = "Bahnschrift";
const BODY_FONT = "Segoe UI";

const screenshots = {
  cover: "C:\\Users\\USER\\AppData\\Local\\Temp\\codex-clipboard-d2666d2f-a73f-4c2a-a3bd-aff67bc631be.png",
  student: "C:\\Users\\USER\\AppData\\Local\\Temp\\codex-clipboard-5ad8d958-3237-4279-bc34-a389dc766a42.png",
  admin: "C:\\Users\\USER\\AppData\\Local\\Temp\\codex-clipboard-e41433e5-98ec-4445-8ebe-8d9241bbf67f.png",
  driver: "C:\\Users\\USER\\AppData\\Local\\Temp\\codex-clipboard-a7a7cfc3-c041-4d0d-bef2-136a07287b81.png",
  provider: "C:\\Users\\USER\\AppData\\Local\\Temp\\codex-clipboard-05f85505-c8f9-416c-a55a-1223dbb4e94c.png",
};
const imageBytes = Object.fromEntries(await Promise.all(
  Object.entries(screenshots).map(async ([key, filename]) => [key, await fs.readFile(filename)]),
));

const deck = Presentation.create({ slideSize: { width: W, height: H } });

function rect(slide, x, y, w, h, fill, line = "none", radius = false) {
  return slide.shapes.add({
    geometry: radius ? "roundRect" : "rect",
    position: { left: x, top: y, width: w, height: h },
    fill: fill === "none" ? "none" : { type: "solid", color: fill },
    line: line === "none" ? { fill: "none", width: 0 } : { fill: line, width: 1 },
  });
}

function line(slide, x, y, w, h = 2, color = COLORS.grid) {
  return rect(slide, x, y, w, h, color);
}

function textbox(slide, value, x, y, w, h, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  shape.text = value;
  shape.text.style = {
    typeface: options.font || BODY_FONT,
    fontSize: options.size || 24,
    bold: options.bold || false,
    color: options.color || COLORS.white,
    autoFit: options.autoFit || "shrinkText",
    horizontalAlignment: options.align || "left",
    verticalAlignment: options.valign || "top",
  };
  return shape;
}

function richText(slide, runs, x, y, w, h, options = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: { left: x, top: y, width: w, height: h },
    fill: "none",
    line: { fill: "none", width: 0 },
  });
  shape.text = runs.map(run => ({
    text: run.text,
    style: {
      typeface: run.font || options.font || BODY_FONT,
      fontSize: run.size || options.size || 24,
      bold: Boolean(run.bold),
      color: run.color || options.color || COLORS.white,
    },
  }));
  shape.text.style = {
    typeface: options.font || BODY_FONT,
    fontSize: options.size || 24,
    color: options.color || COLORS.white,
    autoFit: "shrinkText",
    verticalAlignment: options.valign || "top",
  };
  return shape;
}

function addScreenshot(slide, key, x, y, w, h, alt, fit = "cover") {
  rect(slide, x - 3, y - 3, w + 6, h + 6, COLORS.navy3, COLORS.cyan, true);
  return slide.images.add({
    blob: imageBytes[key],
    contentType: "image/png",
    alt,
    fit,
    position: { left: x, top: y, width: w, height: h },
    geometry: "roundRect",
    borderRadius: "rounded-xl",
  });
}

function addHeader(slide, number, title, subtitle = "") {
  slide.background.fill = COLORS.navy;
  textbox(slide, String(number).padStart(2, "0"), 64, 28, 64, 24, {
    font: TITLE_FONT, size: 16, bold: true, color: COLORS.cyan,
  });
  textbox(slide, title, 64, 60, 1120, 56, {
    font: TITLE_FONT, size: 46, bold: true,
  });
  line(slide, 64, 127, 86, 4, COLORS.cyan);
  if (subtitle) {
    textbox(slide, subtitle, 175, 116, 965, 34, { size: 20, color: COLORS.muted });
  }
  textbox(slide, String(number), 1190, 676, 30, 18, { size: 14, color: COLORS.dim, align: "right" });
}

function addPoint(slide, number, title, body, x, y, width = 460) {
  textbox(slide, number, x, y, 58, 38, {
    font: TITLE_FONT, size: 24, bold: true, color: COLORS.cyan,
  });
  textbox(slide, title, x + 68, y, width - 68, 30, {
    font: TITLE_FONT, size: 23, bold: true,
  });
  textbox(slide, body, x + 68, y + 35, width - 68, 60, {
    size: 19, color: COLORS.muted,
  });
}

function notes(slide, value) {
  slide.speakerNotes.textFrame.setText(value);
}

// Slide 1: cover
{
  const slide = deck.slides.add();
  slide.background.fill = COLORS.navy;
  slide.images.add({
    blob: imageBytes.cover,
    contentType: "image/png",
    alt: "BusTrack student live map showing a bus and route stops",
    fit: "cover",
    position: { left: 0, top: 0, width: W, height: H },
  });
  rect(slide, 0, 0, 710, H, COLORS.navy);
  rect(slide, 64, 78, 76, 8, COLORS.cyan);
  textbox(slide, "BusTrack", 64, 125, 610, 100, {
    font: TITLE_FONT, size: 76, bold: true,
  });
  textbox(slide, "Campus bus tracking and transport operations", 67, 235, 555, 92, {
    font: TITLE_FONT, size: 34, color: COLORS.cyanSoft,
  });
  textbox(slide, "A working platform for students, drivers, transport administrators and GPS technicians", 67, 355, 520, 95, {
    size: 23, color: COLORS.muted,
  });
  textbox(slide, "ENTREPRENEURSHIP PRESENTATION", 67, 592, 420, 28, {
    font: TITLE_FONT, size: 16, bold: true, color: COLORS.cyan,
  });
  textbox(slide, "From no tracking to a clear, managed campus journey", 67, 625, 520, 35, {
    size: 21, color: COLORS.white,
  });
  notes(slide, "Open with the present situation: the college does not currently use any bus tracking method. Students depend on estimates, calls or informal communication. BusTrack introduces a single system that serves students and the transport team.");
}

// Slide 2: current situation
{
  const slide = deck.slides.add();
  addHeader(slide, 2, "The current campus experience", "There is no live bus tracking system today");
  textbox(slide, "0", 70, 170, 250, 190, {
    font: TITLE_FONT, size: 150, bold: true, color: COLORS.cyan,
  });
  textbox(slide, "live tracking tools", 86, 355, 290, 45, {
    font: TITLE_FONT, size: 26, bold: true,
  });
  textbox(slide, "Students must estimate where the bus is and when it will reach their stop.", 86, 420, 330, 120, {
    size: 24, color: COLORS.muted,
  });
  line(slide, 470, 175, 2, 405, COLORS.grid);
  addPoint(slide, "01", "Uncertain waiting", "Students may arrive too early or risk missing the bus.", 520, 180, 640);
  addPoint(slide, "02", "Repeated calls", "Drivers and transport staff receive location questions during trips.", 520, 295, 640);
  addPoint(slide, "03", "No journey record", "The college cannot review exact stop arrivals or completed route legs.", 520, 410, 640);
  addPoint(slide, "04", "Limited visibility", "Administrators cannot see the whole fleet from one place.", 520, 525, 640);
  notes(slide, "This slide describes the college's actual starting point. Do not claim that WhatsApp tracking already exists. Explain that any current communication is informal and does not provide a shared operational view.");
}

// Slide 3: solution overview
{
  const slide = deck.slides.add();
  addHeader(slide, 3, "One system, four focused portals", "Each person sees the information needed for their role");
  const columns = [
    ["STUDENT", "Live map and stop-by-stop progress", "Map and Track views\nCurrent and next stop\nOutbound and return journey\nDigital bus pass"],
    ["DRIVER", "Tools for the assigned journey", "Assigned bus and route\nTrip controls\nOperational alerts\nQR pass verification"],
    ["ADMIN", "Complete transport management", "Fleet and assignments\nRoutes and geofences\nTrip history\nDocuments and users"],
    ["TECHNICIAN", "GPS integration and health", "Provider filtering\nDelay and timestamp checks\nRaw response history\nSafe route recovery"],
  ];
  columns.forEach((item, index) => {
    const x = 64 + index * 292;
    if (index > 0) line(slide, x - 22, 188, 2, 410, COLORS.grid);
    textbox(slide, item[0], x, 180, 240, 30, { font: TITLE_FONT, size: 17, bold: true, color: index === 3 ? COLORS.violet : COLORS.cyan });
    textbox(slide, item[1], x, 230, 250, 90, { font: TITLE_FONT, size: 28, bold: true });
    textbox(slide, item[2], x, 360, 250, 205, { size: 21, color: COLORS.muted });
  });
  textbox(slide, "The same route state powers every portal", 64, 625, 1085, 40, {
    font: TITLE_FONT, size: 28, bold: true, color: COLORS.green,
  });
  notes(slide, "Describe BusTrack as one transport platform rather than four separate applications. All portals read the same verified journey state, so the student, driver, administrator and technician see consistent information.");
}

// Slide 4: system flow
{
  const slide = deck.slides.add();
  addHeader(slide, 4, "How BusTrack works", "Raw coordinates become route information that students can use");
  const steps = [
    ["01", "GPS update", "Vehicle provider or driver phone"],
    ["02", "Validate", "Vehicle, timestamp and freshness"],
    ["03", "Route engine", "Compare with official stop geofences"],
    ["04", "Journey state", "Current stop, next stop and direction"],
    ["05", "Portal update", "Student, driver, admin and technician"],
  ];
  steps.forEach((step, index) => {
    const x = 58 + index * 244;
    if (index < steps.length - 1) {
      line(slide, x + 194, 296, 50, 3, COLORS.cyan);
    }
    rect(slide, x, 210, 195, 180, index === 2 ? COLORS.navy3 : COLORS.navy2, index === 2 ? COLORS.cyan : COLORS.grid, true);
    textbox(slide, step[0], x + 18, 228, 48, 26, { font: TITLE_FONT, size: 17, bold: true, color: COLORS.cyan });
    textbox(slide, step[1], x + 18, 272, 160, 42, { font: TITLE_FONT, size: 25, bold: true });
    textbox(slide, step[2], x + 18, 326, 158, 52, { size: 17, color: COLORS.muted });
  });
  rect(slide, 170, 465, 940, 120, COLORS.navy2, COLORS.grid, true);
  textbox(slide, "The map marker and route progress remain separate", 205, 490, 870, 40, {
    font: TITLE_FONT, size: 29, bold: true, color: COLORS.green, align: "center",
  });
  textbox(slide, "BusTrack preserves the real last-known location while showing whether that location is fresh enough to change the route.", 225, 540, 830, 44, {
    size: 20, color: COLORS.muted, align: "center",
  });
  notes(slide, "Explain the transformation: a GPS coordinate by itself is only a point. BusTrack validates it, compares it with the saved route, then produces stop progress and journey direction. The final portal refresh does not require the user to reload the page.");
}

// Slide 5: student experience
{
  const slide = deck.slides.add();
  addHeader(slide, 5, "Student live tracking", "A clear answer to where the bus is and what happens next");
  textbox(slide, "Students can see", 64, 180, 360, 38, { font: TITLE_FONT, size: 28, bold: true, color: COLORS.cyan });
  addPoint(slide, "01", "Route progress", "Approaching, reached, passed and upcoming stops.", 64, 245, 405);
  addPoint(slide, "02", "Journey direction", "Outbound and return routes appear in the correct order.", 64, 365, 405);
  addPoint(slide, "03", "Location confidence", "Last-update time and stale warnings prevent false certainty.", 64, 485, 405);
  addScreenshot(slide, "student", 505, 170, 710, 455, "BusTrack student route progress with stop statuses");
  notes(slide, "Use the screenshot to show the student's Track view. Point to the current stop, next stop and the passed/upcoming labels. Explain that the Map view uses the same journey state.");
}

// Slide 6: administration
{
  const slide = deck.slides.add();
  addHeader(slide, 6, "Transport administration", "One place to manage the fleet and review completed journeys");
  addScreenshot(slide, "admin", 64, 170, 730, 420, "BusTrack admin trip history and bus selection screen");
  textbox(slide, "Operational control", 845, 180, 330, 38, { font: TITLE_FONT, size: 28, bold: true, color: COLORS.cyan });
  addPoint(slide, "01", "Manage the network", "Buses, routes, stops, drivers, students and assignments.", 845, 245, 355);
  addPoint(slide, "02", "Review evidence", "Stop arrival, departure, dwell time and journey direction.", 845, 365, 355);
  addPoint(slide, "03", "Act on issues", "Driver alerts, document reminders, users and active sessions.", 845, 485, 355);
  notes(slide, "Show how the administrator selects a bus and reviews its trip history. Mention that stop records and driver feedback replace guesswork when someone reports a delay or missed stop.");
}

// Slide 7: driver and passes
{
  const slide = deck.slides.add();
  addHeader(slide, 7, "Driver tools and secure bus passes", "Journey controls and boarding verification on a mobile screen");
  textbox(slide, "Driver portal", 64, 180, 355, 38, { font: TITLE_FONT, size: 28, bold: true, color: COLORS.cyan });
  addPoint(slide, "01", "Assigned journey", "The driver sees the assigned bus, route and live direction.", 64, 245, 410);
  addPoint(slide, "02", "Operational alerts", "Traffic, delay, breakdown and emergency reports reach the administrator.", 64, 365, 410);
  addPoint(slide, "03", "Live pass scan", "Camera preview, short-lived QR and official-photo comparison.", 64, 500, 410);
  addScreenshot(slide, "driver", 520, 170, 695, 430, "BusTrack driver portal showing the bus pass camera preview");
  textbox(slide, "The driver confirms the server decision and the student's official photo before boarding.", 535, 620, 670, 42, { size: 19, color: COLORS.muted, align: "center" });
  notes(slide, "Explain that the live QR changes frequently, reducing screenshot reuse. The server checks the pass, active trip, route, bus and student status. The official photograph remains controlled by the transport office.");
}

// Slide 8: provider reliability
{
  const slide = deck.slides.add();
  addHeader(slide, 8, "GPS reliability and provider health", "Airotrack and Kingstrack work through the same route engine");
  addScreenshot(slide, "provider", 64, 175, 735, 414, "BusTrack Provider Health screen with per-bus timing information");
  textbox(slide, "Built for imperfect data", 845, 180, 360, 38, { font: TITLE_FONT, size: 28, bold: true, color: COLORS.cyan });
  addPoint(slide, "01", "Provider separation", "Each bus stays assigned to its detected GPS provider.", 845, 245, 355);
  addPoint(slide, "02", "Visible delay", "Contact time, device time and update gaps appear separately.", 845, 365, 355);
  addPoint(slide, "03", "Failure isolation", "A problem with one provider does not stop the other.", 845, 485, 355);
  notes(slide, "BusTrack supports the college's mixed GPS fleet. A bus is matched by registration number and retained under its detected provider. Technicians can filter Airotrack and Kingstrack, then inspect the raw response when troubleshooting.");
}

// Slide 9: safety controls
{
  const slide = deck.slides.add();
  addHeader(slide, 9, "Protection from incorrect GPS data", "Delayed or misdated packets remain visible without taking control of the journey");
  const phases = [
    ["RECEIVE", "Keep the original coordinate and device timestamp", COLORS.cyan],
    ["CHECK", "Compare device time, receipt time and accepted state", COLORS.cyanSoft],
    ["DECIDE", "Accept a fresh observation or quarantine an unsafe one", COLORS.amber],
    ["UPDATE", "Advance the route only from valid ordered data", COLORS.green],
  ];
  phases.forEach((phase, index) => {
    const x = 64 + index * 292;
    textbox(slide, String(index + 1).padStart(2, "0"), x, 185, 50, 30, { font: TITLE_FONT, size: 17, bold: true, color: phase[2] });
    line(slide, x, 232, 235, 5, phase[2]);
    textbox(slide, phase[0], x, 265, 235, 35, { font: TITLE_FONT, size: 25, bold: true });
    textbox(slide, phase[1], x, 320, 235, 115, { size: 20, color: COLORS.muted });
  });
  line(slide, 64, 470, 1120, 2, COLORS.grid);
  textbox(slide, "Additional safeguards", 64, 505, 300, 34, { font: TITLE_FONT, size: 25, bold: true, color: COLORS.violet });
  textbox(slide, "Older observations cannot move the route backward. A route reset waits for a fresh arrival at its selected first stop. The real bus marker stays at its last-known coordinate.", 390, 500, 790, 95, { size: 23, color: COLORS.white });
  notes(slide, "This is a key differentiator. Explain that BusTrack does not simply trust the newest response received from a provider. It considers the GPS device time and the already accepted state before changing the journey.");
}

// Slide 10: comparison table
{
  const slide = deck.slides.add();
  addHeader(slide, 10, "Three approaches to campus tracking", "The college currently operates without a tracking system");
  const values = [
    ["Capability", "Current situation", "Possible WhatsApp workaround", "BusTrack"],
    ["Live visibility", "No shared live view", "Someone manually shares phone location", "Vehicle GPS with phone continuity"],
    ["Stop progress", "Students estimate", "A map pin without route meaning", "Approaching, reached, passed and upcoming"],
    ["Freshness", "Unknown", "Depends on the sender and phone", "Device time, receipt time and stale warning"],
    ["Fleet records", "No structured history", "Messages remain scattered in chats", "Searchable trips and stop events"],
    ["Operations", "Calls and informal updates", "Multiple groups and repeated messages", "Role portals, alerts and assignments"],
    ["Boarding", "Manual identification", "Separate from tracking", "Live QR with official-photo check"],
  ];
  const table = slide.tables.add({
    rows: values.length,
    columns: 4,
    left: 62,
    top: 175,
    width: 1155,
    height: 440,
    columnWidths: [180, 260, 305, 410],
    values,
  });
  table.borders.assign({ style: "solid", fill: COLORS.grid, width: 1 });
  for (let r = 0; r < values.length; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      const cell = table.getCell(r, c);
      cell.fill = r === 0 ? COLORS.navy3 : (c === 3 ? "#0D354E" : COLORS.navy2);
      cell.text.style = {
        typeface: r === 0 || c === 0 ? TITLE_FONT : BODY_FONT,
        fontSize: r === 0 ? 21 : 19,
        bold: r === 0 || c === 0 || c === 3,
        color: r === 0 ? COLORS.white : (c === 3 ? COLORS.cyanSoft : COLORS.muted),
        autoFit: "shrinkText",
        verticalAlignment: "middle",
      };
    }
  }
  textbox(slide, "WhatsApp remains useful for communication. BusTrack manages the structured transport journey.", 64, 635, 1110, 35, { size: 19, color: COLORS.muted, align: "center" });
  notes(slide, "The WhatsApp column describes a possible informal workaround, not the college's current process. Position WhatsApp as a communication tool. BusTrack adds route meaning, reliability controls, history and role-based operations.");
}

// Slide 11: value
{
  const slide = deck.slides.add();
  addHeader(slide, 11, "Why a college would adopt BusTrack", "The benefit extends beyond showing a bus marker");
  const rows = [
    ["STUDENTS", "Less uncertainty", "See route progress before leaving for the stop."],
    ["DRIVERS", "Fewer location calls", "Use a focused journey screen and send structured alerts."],
    ["TRANSPORT OFFICE", "Clear operating record", "Review routes, assignments, stop times and incidents."],
    ["COLLEGE", "A platform that can expand", "Start with one route and grow across the fleet."],
  ];
  rows.forEach((row, index) => {
    const y = 175 + index * 112;
    textbox(slide, row[0], 64, y + 5, 210, 26, { font: TITLE_FONT, size: 16, bold: true, color: index === 3 ? COLORS.violet : COLORS.cyan });
    textbox(slide, row[1], 305, y, 325, 38, { font: TITLE_FONT, size: 28, bold: true });
    textbox(slide, row[2], 680, y + 2, 500, 56, { size: 22, color: COLORS.muted });
    line(slide, 64, y + 85, 1120, 2, COLORS.grid);
  });
  textbox(slide, "Measure the result", 64, 635, 230, 28, { font: TITLE_FONT, size: 20, bold: true, color: COLORS.green });
  textbox(slide, "Track location freshness, student usage, driver calls, missed-bus complaints and completed journeys during the pilot.", 315, 630, 865, 44, { size: 19, color: COLORS.white });
  notes(slide, "Avoid claiming measured reductions before a pilot. Explain that the institution can create a baseline, run BusTrack on one route, and then compare usage, freshness and transport complaints.");
}

// Slide 12: rollout
{
  const slide = deck.slides.add();
  addHeader(slide, 12, "A practical campus rollout", "Begin with one route, verify it and expand with evidence");
  const phases = [
    ["01", "Prepare", "Confirm the bus, driver, route, stop coordinates and GPS registration."],
    ["02", "Pilot", "Enroll one route's students and test outbound and return journeys."],
    ["03", "Expand", "Add buses route by route and train the transport office and drivers."],
  ];
  phases.forEach((phase, index) => {
    const x = 75 + index * 395;
    textbox(slide, phase[0], x, 190, 90, 42, { font: TITLE_FONT, size: 30, bold: true, color: COLORS.cyan });
    line(slide, x, 245, 320, 5, index === 2 ? COLORS.green : COLORS.cyan);
    textbox(slide, phase[1], x, 285, 320, 48, { font: TITLE_FONT, size: 34, bold: true });
    textbox(slide, phase[2], x, 350, 320, 105, { size: 22, color: COLORS.muted });
  });
  rect(slide, 75, 520, 1110, 90, COLORS.navy2, COLORS.grid, true);
  textbox(slide, "Pilot review", 105, 546, 190, 30, { font: TITLE_FONT, size: 22, bold: true, color: COLORS.amber });
  textbox(slide, "Validate stop detection, location freshness, portal usability and operational response before a full-fleet launch.", 315, 540, 830, 48, { size: 21, color: COLORS.white });
  notes(slide, "Recommend a limited first deployment. The route must be physically tested in both directions, including the terminal reversal. The pilot also gives the college real evidence for the final entrepreneurship case.");
}

// Slide 13: close
{
  const slide = deck.slides.add();
  slide.background.fill = COLORS.navy;
  rect(slide, 64, 82, 88, 7, COLORS.cyan);
  textbox(slide, "Start with one route", 64, 125, 810, 88, { font: TITLE_FONT, size: 64, bold: true });
  textbox(slide, "Give students a clear journey and give the college a transport system it can manage.", 67, 235, 780, 90, { font: TITLE_FONT, size: 34, color: COLORS.cyanSoft });
  line(slide, 64, 375, 1120, 2, COLORS.grid);
  const actions = [
    ["1", "Select the pilot bus and route"],
    ["2", "Verify every stop in both directions"],
    ["3", "Enroll the driver and pilot students"],
    ["4", "Measure the result and expand"],
  ];
  actions.forEach((action, index) => {
    const x = 64 + index * 290;
    textbox(slide, action[0], x, 420, 42, 38, { font: TITLE_FONT, size: 25, bold: true, color: COLORS.green });
    textbox(slide, action[1], x, 472, 245, 72, { font: TITLE_FONT, size: 23, bold: true });
  });
  textbox(slide, "BUSTRACK", 64, 632, 180, 28, { font: TITLE_FONT, size: 18, bold: true, color: COLORS.cyan });
  textbox(slide, "Campus transport, made visible", 870, 630, 345, 30, { size: 20, color: COLORS.muted, align: "right" });
  notes(slide, "Close by asking for a one-route campus pilot. The purpose of the pilot is to demonstrate reliability, collect usage evidence and confirm that BusTrack fits the college's daily transport process.");
}

await fs.mkdir(TMP_DIR, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });
const stagingDir = path.join(workspaceDir, ".codex-finalizer");
await fs.mkdir(stagingDir, { recursive: true });
const candidatePath = path.join(stagingDir, "BusTrack_candidate.pptx");
await (await PresentationFile.exportPptx(deck)).save(candidatePath);

const requirements = {
  explicitTotalSlideCount: 13,
  requiredNativeTableOwnerSlides: [10],
  requiredNativeChartOwnerSlides: [],
};
const fontPolicy = {
  basis: "design",
  families: [TITLE_FONT, BODY_FONT],
};
const result = await finalizePresentation({
  ...requirements,
  workspaceDir,
  candidatePath,
  finalPath: FINAL_PPTX,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, "container_tools", "inspect_presentation_package_integrity.py"),
  layoutValidatorPath: path.join(SKILL_DIR, "container_tools", "inspect_presentation_layout_geometry.py"),
  layoutArgs: [
    "--expected-slide-size-emu", "12192000,6858000",
    "--validate-bullet-geometry",
    "--validate-heading-fit",
    "--require-native-table-slide", "10",
  ],
  requiredNativeTableOwnerSlides: [10],
  fontPolicy,
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, "BusTrack_Entrepreneurship_Introduction.validation.json"),
});

console.log(JSON.stringify({ finalPath: FINAL_PPTX, result }, null, 2));
