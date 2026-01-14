const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly';
let tokenClient = null;

// 🔹 Si ya tiene token y autorización → saltar auth.html
if (
    localStorage.getItem('gapi_token') &&
    localStorage.getItem('google_authorized')
) {
    window.location.href = '../index.html';
}

function initGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: '574094373828-h613uosf818tdq6q619bv76ah0upmbb4.apps.googleusercontent.com',
        scope: SCOPES,
        callback: (response) => {
            if (response.error) {
                console.error("Error en autorización:", response);
                return;
            }

            // 🧠 Marca que el usuario ya autorizó
            localStorage.setItem('google_authorized', 'true');

            // ❗ NO borres el spreadsheet aquí
            // localStorage.removeItem('user_spreadsheet_id');

            localStorage.setItem('gapi_token', response.access_token);

            window.location.href = '../index.html';
        },
    });

    console.log("Cliente OAuth inicializado");
}

function waitForGoogle() {
    if (window.google && google.accounts && google.accounts.oauth2) {
        initGoogleAuth();
    } else {
        setTimeout(waitForGoogle, 100);
    }
}

waitForGoogle();

document.getElementById('authorize-btn').addEventListener('click', () => {
    if (!tokenClient) {
        alert("Google aún se está cargando, intenta de nuevo.");
        return;
    }

    const alreadyAuthorized = localStorage.getItem('google_authorized');

    tokenClient.requestAccessToken({
        prompt: alreadyAuthorized ? '' : 'consent'
    });
});
