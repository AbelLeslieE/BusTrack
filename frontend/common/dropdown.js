/* ==========================================================
   BUSTRACK
   PREMIUM DROPDOWN COMPONENT
========================================================== */

export function createDropdown({

    id = "",

    placeholder = "Select",

    value = "",

    items = []

}){

    const root = document.createElement("div");

    root.className = "dropdown";
    root.dataset.value = value;
    if(id){

        root.id = id;

    }

    root.innerHTML = `

        <button
            type="button"
            class="dropdown-trigger"
        >

            <span class="dropdown-value">

                ${value || placeholder}

            </span>

            <span class="dropdown-arrow">

                ▾

            </span>

        </button>

        <div class="dropdown-menu">

            <div class="dropdown-search-wrapper">

                <input
                    type="text"
                    class="dropdown-search"
                    placeholder="Search..."
                    autocomplete="off"
                >

            </div>

            <div class="dropdown-items">

            </div>

        </div>

    `;

    const trigger = root.querySelector(".dropdown-trigger");

    const menu = root.querySelector(".dropdown-menu");

    const itemsContainer =
        root.querySelector(".dropdown-items");

    const searchInput =
        root.querySelector(".dropdown-search");

    const valueText =
        root.querySelector(".dropdown-value");

    trigger.onclick = () => {

        document

            .querySelectorAll(".dropdown.open")

            .forEach(dropdown => {

                if (dropdown !== root)

                    dropdown.classList.remove("open");

            });

        root.classList.toggle("open");

        if (root.classList.contains("open")) {

            searchInput.value = "";

            renderItems(items);
            searchInput.dispatchEvent(
                new Event("input")
            );

            setTimeout(() => {

                searchInput.focus();

            }, 50);

        }

    };

    menu.onclick=(e)=>{

        const item=e.target.closest(".dropdown-item");

        if(!item) return;

        root.setValue(item.dataset.value);

        searchInput.value = "";

        renderItems(items);

        root.classList.remove("open");

        root.dispatchEvent(new CustomEvent(

            "change",

            {

                detail:item.dataset.value

            }

        ));

    };

    document.addEventListener("click",(e)=>{

        if(!root.contains(e.target))

            root.classList.remove("open");

    });
    /************************************************************
     * PRIVATE HELPERS
     ************************************************************/

    function renderItems(list) {

        if (!list.length) {

            itemsContainer.innerHTML = `

                <div class="dropdown-empty">

                    No results found

                </div>

            `;

            return;

        }

        itemsContainer.innerHTML = list.map(item => {

            const option =
                typeof item === "object"
                    ? item
                    : {
                        value: item,
                        label: item
                    };

            return `

                <button
                    type="button"
                    class="dropdown-item"
                    data-value="${option.value}"
                >

                    ${option.label}

                </button>

            `;

        }).join("");

    }


    /************************************************************
     * PUBLIC METHODS
     ************************************************************/

    root.getValue = () => {

        return root.dataset.value || "";

    };


    root.setValue = (newValue) => {

        root.dataset.value = newValue;

        const option = items.find(item => {

            if (typeof item === "object") {

                return String(item.value) === String(newValue);

            }

            return String(item) === String(newValue);

        });

        if (option) {

            valueText.textContent =
                typeof option === "object"
                    ? option.label
                    : option;

        }

        else {

            valueText.textContent = newValue || placeholder;

        }

    };


    root.clear = () => {

        root.dataset.value = "";

        valueText.textContent = placeholder;

    };
    root.onChange = (callback) => {

    root.addEventListener("change", event => {

            callback(event.detail);

        });

    };


    /************************************************************
     * NEW
     * Dynamically replace dropdown items
     ************************************************************/

    root.setItems = (newItems = []) => {

        items = newItems;

        renderItems(items);

    };


    /************************************************************
     * Initial Rendering
     ************************************************************/

    renderItems(items);

    if (value) {

        root.setValue(value);

    }
    /************************************************************
     * LIVE SEARCH
     ************************************************************/

    searchInput.addEventListener("input", () => {

        const query = searchInput.value
            .trim()
            .toLowerCase();

        const filteredItems = items.filter(item => {

            const option =
                typeof item === "object"
                    ? item
                    : {
                        value: item,
                        label: item
                    };

            return option.label
                .toLowerCase()
                .includes(query);

        });

        renderItems(filteredItems);

    });
    return root;

    }