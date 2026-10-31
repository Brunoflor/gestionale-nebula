# Gestionale Nebula — Nebula 3D

App web statica (HTML/CSS/JS, nessun build, nessun backend) per gestire le schede clienti.

- Apri `index.html` direttamente nel browser, oppure pubblica la cartella su GitHub Pages / qualsiasi hosting statico.
- In locale con server: `python3 -m http.server 8000` e vai su http://localhost:8000
- I dati (foto e file STL inclusi) sono salvati in **IndexedDB nel browser del dispositivo**: telefono e PC non si sincronizzano.
  Usa **Dati → Esporta backup JSON** / **Importa** per spostarli o fare copie di sicurezza.

## Brand
Look & logo ispirati al profilo Instagram [@nebula3dlab](https://www.instagram.com/nebula3dlab): nero, arancio `#ed6e07`, rame, crema. Il logo (`assets/logo-nebula3d.jpg`) è l'immagine profilo pubblica. I colori sono variabili CSS in `css/style.css` (`:root`).
