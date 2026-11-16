import { escapeHtml } from '../../common/security.js';

async function request(path = '', options = {}) {
    const response = await fetch(`/api/route-studio${path}`, {
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        ...options
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Unable to update route capture.');
    return result;
}

function captureCards(data) {
    if (!data.buses.length) return '<p class="trace-capture-empty">No buses are available.</p>';
    return data.buses.map(bus => {
        const last = bus.last_trace;
        const traceStatus = last
            ? `<span class="trace-last-status" data-status="${escapeHtml(last.status.toLowerCase())}">${escapeHtml(last.status)}</span><span>${escapeHtml(last.name)}</span>`
            : '<span>No GPS route has been recorded yet.</span>';
        return `<article class="trace-bus-card" data-bus-id="${bus.id}">
            <header><div><h3>${escapeHtml(bus.bus_number)}</h3><p>${escapeHtml(bus.registration_number)}</p></div><span class="trace-provider">${escapeHtml(bus.provider)}</span></header>
            <div class="trace-window-switches">
                <label><span><b>Morning trace</b><small>07:00–09:15 IST</small></span><input type="checkbox" data-window="morning" ${bus.morning_enabled ? 'checked' : ''}><i aria-hidden="true"></i></label>
                <label><span><b>Evening trace</b><small>16:15–19:15 IST</small></span><input type="checkbox" data-window="evening" ${bus.evening_enabled ? 'checked' : ''}><i aria-hidden="true"></i></label>
            </div>
            <p class="trace-last">${traceStatus}</p>
        </article>`;
    }).join('');
}

export function render() {
    const page = document.createElement('section');
    page.className = 'trace-assignment-page';
    page.innerHTML = `
        <header class="trace-assignment-hero">
            <div><p>ROUTE CAPTURE</p><h1>Choose how each route is traced</h1><span>Keep phone Tracer assignments and hardware GPS recording independently controlled.</span></div>
            <span class="trace-assignment-state">Loading…</span>
        </header>
        <section class="trace-assignment-card trace-phone-card">
            <div class="trace-assignment-heading"><span>01</span><div><h2>Phone Tracer assignment</h2><p>The existing Tracer portal stays unchanged. Assign one active Tracer account to the bus they will ride.</p></div></div>
            <label>Tracer account<select class="trace-assignment-tracer" aria-label="Tracer account"></select></label>
            <label>Bus<select class="trace-assignment-bus" aria-label="Bus"></select></label>
            <button class="trace-assignment-submit" type="button">Assign phone Tracer</button>
            <p class="trace-assignment-message" role="status"></p>
        </section>
        <section class="trace-assignment-card trace-provider-card">
            <div class="trace-assignment-heading"><span>02</span><div><h2>Bus GPS route recording</h2><p>Arm only the buses and peak windows you want. BusTrack copies accepted Airotrack or Kingstrack fixes into one recording per enabled window; live tracking continues normally whether these switches are on or off.</p></div></div>
            <div class="trace-schedule-note"><b>Automatic boundaries</b><span>Morning 07:00–09:15 · Evening 16:15–19:15 · Indian Standard Time</span></div>
            <div class="trace-bus-grid" aria-live="polite"><p class="trace-capture-empty">Loading bus controls…</p></div>
            <p class="trace-provider-message" role="status"></p>
        </section>`;
    let closed = false;
    let captureData = null;
    const setMessage = (selector, value, tone = '') => {
        if (closed) return;
        const node = page.querySelector(selector);
        node.textContent = value;
        node.dataset.tone = tone;
    };
    const showCaptureData = data => {
        captureData = data;
        page.querySelector('.trace-bus-grid').innerHTML = captureCards(data);
        const armed = data.buses.filter(bus => bus.morning_enabled || bus.evening_enabled).length;
        setMessage('.trace-provider-message', armed
            ? `${armed} bus${armed === 1 ? '' : 'es'} armed. Each enabled window becomes one separate recorded path.`
            : 'GPS route recording is off for every bus. Live location updates are unaffected.');
    };
    const load = async () => {
        const [assignmentData, providerData] = await Promise.all([
            request(),
            request('/provider-capture')
        ]);
        if (closed) return;
        const tracer = page.querySelector('.trace-assignment-tracer');
        const bus = page.querySelector('.trace-assignment-bus');
        tracer.innerHTML = assignmentData.tracers.length
            ? assignmentData.tracers.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')
            : '<option value="">No active Tracer accounts</option>';
        bus.innerHTML = assignmentData.buses.length
            ? assignmentData.buses.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')
            : '<option value="">No buses available</option>';
        page.querySelector('.trace-assignment-submit').disabled = !assignmentData.tracers.length || !assignmentData.buses.length;
        page.querySelector('.trace-assignment-state').textContent = `${assignmentData.buses.length} buses · ${assignmentData.tracers.length} phone Tracers`;
        setMessage('.trace-assignment-message', 'Ready to assign.');
        showCaptureData(providerData);
    };
    page.querySelector('.trace-assignment-submit').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        setMessage('.trace-assignment-message', 'Saving assignment…');
        try {
            const tracer = page.querySelector('.trace-assignment-tracer');
            const bus = page.querySelector('.trace-assignment-bus');
            await request('/assignment', {method:'PUT', body:JSON.stringify({user_id:Number(tracer.value), bus_id:Number(bus.value)})});
            setMessage('.trace-assignment-message', `${tracer.options[tracer.selectedIndex].text} can now record bus ${bus.options[bus.selectedIndex].text}.`, 'success');
        } catch (error) {
            setMessage('.trace-assignment-message', error.message, 'error');
        } finally {
            if (!closed) button.disabled = false;
        }
    });
    page.querySelector('.trace-bus-grid').addEventListener('change', async event => {
        const input = event.target.closest('input[data-window]');
        const card = input?.closest('[data-bus-id]');
        if (!input || !card || !captureData) return;
        const busId = Number(card.dataset.busId);
        const morning = card.querySelector('[data-window="morning"]');
        const evening = card.querySelector('[data-window="evening"]');
        const changedTo = input.checked ? 'on' : 'off';
        morning.disabled = true;
        evening.disabled = true;
        setMessage('.trace-provider-message', `Turning ${input.dataset.window} recording ${changedTo}…`);
        try {
            const updated = await request(`/provider-capture/${busId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    morning_enabled: morning.checked,
                    evening_enabled: evening.checked
                })
            });
            if (!closed) showCaptureData(updated);
        } catch (error) {
            input.checked = !input.checked;
            morning.disabled = false;
            evening.disabled = false;
            setMessage('.trace-provider-message', error.message, 'error');
        }
    });
    load().catch(error => {
        setMessage('.trace-assignment-message', error.message, 'error');
        setMessage('.trace-provider-message', error.message, 'error');
    });
    page.cleanup = () => { closed = true; };
    return page;
}
