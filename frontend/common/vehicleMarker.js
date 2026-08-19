/* One marker asset is shared by every live-map portal. */

export function createVehicleMarkerIcon() {
    return L.divIcon({
        className: "fleet-vehicle-marker",
        html: `<div class="fleet-vehicle-marker__visual" role="img" aria-label="Bus location">
            <img src="/static/assets/images/bus-marker.svg" alt="">
        </div>`,
        iconSize: [64, 88],
        iconAnchor: [32, 44],
        popupAnchor: [0, -44],
    });
}
