import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("live tracking searches buses across fleet identity and assignment fields", () => {
    const source = read("frontend/modules/js/adminTrackingService.js")
        .replace(/^import .*;\r?$/gm, "")
        .replace(/^export /gm, "");
    const cards = [
        {dataset: {fleetSearch: "bus-007 kl64p4797 george kodungallur"}, hidden: false},
        {dataset: {fleetSearch: "bus-012 kl40a6499 maya aluva"}, hidden: false},
    ];
    const tripList = {
        emptyResult: null,
        querySelectorAll: selector => selector === ".trip-card" ? cards : [],
        querySelector(selector) {
            return selector === ".fleet-search-empty" ? this.emptyResult : null;
        },
        appendChild(element) { this.emptyResult = element; },
    };
    const input = {value: ""};
    const clear = {hidden: true};
    const summary = {textContent: ""};
    const document = {
        getElementById(id) {
            return {tripList, fleetBusSearch: input, fleetBusSearchClear: clear, fleetSearchSummary: summary}[id] ?? null;
        },
        createElement: () => ({className: "", textContent: "", hidden: false}),
    };
    const context = vm.createContext({
        document, Map, Set, WeakSet, Date, Intl, Number, String, Object,
        console: {log() {}, error() {}, warn() {}},
    });
    vm.runInContext(source, context);
    const filter = query => vm.runInContext(
        `filterFleetBusCards(${JSON.stringify(query)})`,
        context,
    );

    assert.equal(filter("KL64P"), 1);
    assert.equal(cards[0].hidden, false);
    assert.equal(cards[1].hidden, true);
    assert.equal(summary.textContent, "1 of 2 buses shown");
    assert.equal(clear.hidden, false);

    assert.equal(filter("aluva"), 1);
    assert.equal(cards[0].hidden, true);
    assert.equal(cards[1].hidden, false);

    assert.equal(filter("missing"), 0);
    assert.equal(tripList.emptyResult.hidden, false);
    assert.equal(tripList.emptyResult.textContent, "No buses match your search.");

    assert.equal(filter(""), 2);
    assert.equal(cards.every(card => !card.hidden), true);
    assert.equal(clear.hidden, true);
});

test("live tracking exposes an accessible search and clear control", () => {
    const page = read("frontend/modules/js/live_tracking.js");
    const styles = read("frontend/modules/css/live_tracking.css");

    assert.match(page, /id="fleetBusSearch"[\s\S]*?type="search"/);
    assert.match(page, /Bus, registration, driver or route/);
    assert.match(page, /filterFleetBusCards\(busSearch\.value\)/);
    assert.match(page, /id="fleetBusSearchClear"/);
    assert.match(styles, /\.live-bus-search-control input/);
    assert.match(styles, /\.trip-card\[hidden\]/);
});
