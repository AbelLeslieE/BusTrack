/* ==========================================================
   BUSTRACK
   SHARED SEARCHABLE DROPDOWN
   ========================================================== */

/**
 * Creates a searchable dropdown that can safely be used inside cards, modals,
 * and scrollable layouts. The menu is temporarily moved to document.body while
 * open so an ancestor with overflow:hidden cannot cut off its options.
 */
export function createDropdown({
    id = "",
    placeholder = "Select",
    value = "",
    items = []
} = {}) {
    const root = document.createElement("div");
    root.className = "dropdown";
    root.dataset.value = value == null ? "" : String(value);

    if (id) root.id = id;

    root.innerHTML = `
        <button type="button" class="dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">
            <span class="dropdown-value"></span>
            <span class="dropdown-arrow" aria-hidden="true">▾</span>
        </button>
        <div class="dropdown-menu" role="presentation">
            <div class="dropdown-search-wrapper">
                <input type="text" class="dropdown-search" placeholder="Search..." autocomplete="off" aria-label="Search options">
            </div>
            <div class="dropdown-items" role="listbox"></div>
        </div>`;

    const trigger = root.querySelector(".dropdown-trigger");
    const menu = root.querySelector(".dropdown-menu");
    const searchInput = root.querySelector(".dropdown-search");
    const itemsContainer = root.querySelector(".dropdown-items");
    const valueText = root.querySelector(".dropdown-value");
    let isOpen = false;

    const normaliseItem = item => (
        typeof item === "object"
            ? { value: item.value ?? "", label: item.label ?? item.value ?? "" }
            : { value: item ?? "", label: item ?? "" }
    );

    function renderItems(list) {
        itemsContainer.replaceChildren();

        if (!list.length) {
            const empty = document.createElement("div");
            empty.className = "dropdown-empty";
            empty.textContent = "No results found";
            itemsContainer.appendChild(empty);
            return;
        }

        list.forEach(item => {
            const option = normaliseItem(item);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "dropdown-item";
            button.dataset.value = String(option.value);
            button.setAttribute("role", "option");
            button.textContent = String(option.label);
            itemsContainer.appendChild(button);
        });
    }

    function setDisplayValue(newValue) {
        const selected = items
            .map(normaliseItem)
            .find(item => String(item.value) === String(newValue));

        valueText.textContent = selected
            ? String(selected.label)
            : (newValue ? String(newValue) : placeholder);
    }

    function positionMenu() {
        if (!isOpen || !root.isConnected) return;

        const rect = trigger.getBoundingClientRect();
        const viewportPadding = 8;
        const width = Math.min(
            Math.max(rect.width, 220),
            window.innerWidth - (viewportPadding * 2)
        );
        const left = Math.max(
            viewportPadding,
            Math.min(rect.left, window.innerWidth - width - viewportPadding)
        );

        const spaceBelow = window.innerHeight - rect.bottom - 18;
        const spaceAbove = rect.top - 18;
        const openAbove = spaceBelow < 180 && spaceAbove > spaceBelow;
        const availableSpace = Math.max(120, openAbove ? spaceAbove : spaceBelow);
        const menuHeight = Math.min(menu.scrollHeight || 0, availableSpace);

        menu.style.width = `${width}px`;
        menu.style.left = `${left}px`;
        menu.style.top = openAbove
            ? `${Math.max(viewportPadding, rect.top - menuHeight - 10)}px`
            : `${Math.min(rect.bottom + 10, window.innerHeight - viewportPadding)}px`;
        menu.style.maxHeight = `${availableSpace}px`;
        itemsContainer.style.maxHeight = `${Math.max(48, availableSpace - 74)}px`;
    }

    function open() {
        if (isOpen) return;

        document.querySelectorAll(".dropdown.open").forEach(dropdown => {
            if (dropdown !== root) dropdown.close?.();
        });

        isOpen = true;
        root.classList.add("open");
        trigger.setAttribute("aria-expanded", "true");
        document.body.appendChild(menu);
        menu.classList.add("dropdown-menu--open");
        searchInput.value = "";
        renderItems(items);
        positionMenu();
        window.setTimeout(() => searchInput.focus(), 0);
    }

    function close() {
        if (!isOpen) return;

        isOpen = false;
        root.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        menu.classList.remove("dropdown-menu--open");
        menu.removeAttribute("style");
        itemsContainer.removeAttribute("style");

        if (root.isConnected) root.appendChild(menu);
        else menu.remove();
    }

    trigger.addEventListener("click", () => {
        if (isOpen) close();
        else open();
    });

    menu.addEventListener("click", event => {
        const item = event.target.closest(".dropdown-item");
        if (!item) return;

        root.setValue(item.dataset.value);
        close();
        root.dispatchEvent(new CustomEvent("change", {
            detail: item.dataset.value,
            bubbles: true
        }));
    });

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLowerCase();
        renderItems(items.filter(item =>
            String(normaliseItem(item).label).toLowerCase().includes(query)
        ));
        positionMenu();
    });

    document.addEventListener("click", event => {
        if (isOpen && !root.contains(event.target) && !menu.contains(event.target)) close();
    });

    document.addEventListener("keydown", event => {
        if (isOpen && event.key === "Escape") {
            close();
            trigger.focus();
        }
    });

    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);

    root.getValue = () => root.dataset.value || "";
    root.setValue = newValue => {
        const normalisedValue = newValue == null ? "" : String(newValue);
        root.dataset.value = normalisedValue;
        setDisplayValue(normalisedValue);
    };
    root.clear = () => root.setValue("");
    root.setItems = (newItems = []) => {
        items = Array.isArray(newItems) ? newItems : [];
        renderItems(items);
        setDisplayValue(root.getValue());
        positionMenu();
    };
    root.onChange = callback => root.addEventListener("change", event => callback(event.detail));
    root.close = close;

    renderItems(items);
    setDisplayValue(root.getValue());

    return root;
}
