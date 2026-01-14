const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
let tokenClient;

// Función para inicializar el cliente de forma segura
function maybeInitTokenClient() {
    if (typeof google === 'undefined') {
        // Si Google no ha cargado, esperamos 100ms y reintentamos
        setTimeout(maybeInitTokenClient, 100);
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '574094373828-h613uosf818tdq6q619bv76ah0upmbb4.apps.googleusercontent.com',
        scope: SCOPES,
        callback: (response) => {
            if (response.error !== undefined) {
                console.error("Error en autorización:", response);
                return;
            }
            // Guardamos el token y vamos al dashboard
            localStorage.setItem('gapi_token', response.access_token);
            window.location.href = '../index.html';
        },
    });
    console.log("Cliente de Google Token inicializado");
}

window.onload = maybeInitTokenClient;

document.getElementById('authorize-btn').onclick = () => {
    if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        alert("El servicio de Google aún está cargando. Intenta de nuevo en un segundo.");
    }
};