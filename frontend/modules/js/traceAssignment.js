import { escapeHtml } from '../../common/security.js';

async function request(path = '', options = {}) {
    const response = await fetch(`/api/route-studio${path}`, {
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        ...options
    });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Unable to update the assignment.');
    return result;
}

export function render() {
    const page = document.createElement('section');
    page.className = 'trace-assignment-page';
    page.innerHTML = `
        <header class="trace-assignment-hero">
            <div><p>TRACER OPERATIONS</p><h1>Assign a bus for tracing</h1><span>Choose which active Tracer account will record a bus route.</span></div>
            <span class="trace-assignment-state">Loading accounts…</span>
        </header>
        <section class="trace-assignment-card">
            <div class="trace-assignment-heading"><span>01</span><div><h2>Select the Tracer</h2><p>The selected person will see only the bus assigned here.</p></div></div>
            <label>Tracer account<select class="trace-assignment-tracer" aria-label="Tracer account"></select></label>
            <div class="trace-assignment-heading"><span>02</span><div><h2>Select the bus</h2><p>An unfinished recording must be completed before reassignment.</p></div></div>
            <label>Bus<select class="trace-assignment-bus" aria-label="Bus"></select></label>
            <button class="trace-assignment-submit" type="button">Assign bus</button>
            <p class="trace-assignment-message" role="status"></p>
        </section>`;
    let closed = false;
    const message = (value, tone = '') => {
        if (closed) return;
        const node = page.querySelector('.trace-assignment-message');
        node.textContent = value;
        node.dataset.tone = tone;
    };
    const load = async () => {
        const data = await request();
        if (closed) return;
        const tracerSelect = page.querySelector('.trace-assignment-tracer');
        const busSelect = page.querySelector('.trace-assignment-bus');
        tracerSelect.innerHTML = data.tracers.length
            ? data.tracers.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')
            : '<option value="">No active Tracer accounts</option>';
        busSelect.innerHTML = data.buses.length
            ? data.buses.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')
            : '<option value="">No buses available</option>';
        page.querySelector('.trace-assignment-state').textContent = `${data.tracers.length} Tracer account${data.tracers.length === 1 ? '' : 's'} · ${data.buses.length} bus${data.buses.length === 1 ? '' : 'es'}`;
        page.querySelector('.trace-assignment-submit').disabled = !data.tracers.length || !data.buses.length;
        message('Ready to assign.');
    };
    page.querySelector('.trace-assignment-submit').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        message('Saving assignment…');
        try {
            const tracer = page.querySelector('.trace-assignment-tracer');
            const bus = page.querySelector('.trace-assignment-bus');
            await request('/assignment', {method:'PUT', body:JSON.stringify({user_id:Number(tracer.value), bus_id:Number(bus.value)})});
            message(`${tracer.options[tracer.selectedIndex].text} can now record bus ${bus.options[bus.selectedIndex].text}.`, 'success');
        } catch (error) {
            message(error.message, 'error');
        } finally {
            if (!closed) button.disabled = false;
        }
    });
    load().catch(error => message(error.message, 'error'));
    page.cleanup = () => { closed = true; };
    return page;
}
