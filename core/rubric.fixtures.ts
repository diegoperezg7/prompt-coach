// Casos fijos de la rúbrica: puntos esperados por criterio, en el orden de la rúbrica
// (objetivo, contexto, detalle, aceptación, restricciones, formato, claridad). Cada uno cubre un idioma o un fallo
// ya corregido; si un cambio de la rúbrica mueve alguno, el test lo dice. `lang: null` = detección no segura.
import type { Lang } from './rubric.ts'

export const FIXTURES: { id: string; text: string; lang: Lang | null; score: number; points: number[] }[] = [
  { id: "good-en", text: "fix the login in src/auth/login.ts: submitting the form returns 500 instead of signing in. Add a test that covers it and don't touch signup", lang: "en", score: 75, points: [20, 15, 15, 12, 8, 0, 5] },
  { id: "good-es", text: "arregla el login de src/auth/login.ts: al enviar el formulario devuelve 500 en vez de entrar. Añade un test que lo cubra y no toques el registro", lang: "es", score: 75, points: [20, 15, 15, 12, 8, 0, 5] },
  { id: "good-fr", text: "corrige la connexion dans src/auth/login.ts : l'envoi du formulaire renvoie 500 au lieu de connecter. Ajoute un test qui le couvre et ne touche pas à l'inscription", lang: "fr", score: 75, points: [20, 15, 15, 12, 8, 0, 5] },
  { id: "good-de", text: "behebe den Login in src/auth/login.ts: das Absenden des Formulars liefert 500 statt der Anmeldung. Füge einen Test hinzu, der das abdeckt, und ändere nicht die Registrierung", lang: "de", score: 75, points: [20, 15, 15, 12, 8, 0, 5] },
  { id: "good-pt", text: "conserta o login em src/auth/login.ts: enviar o formulário retorna 500 em vez de entrar. Adicione um teste que cubra isso e não toque no cadastro", lang: "pt", score: 75, points: [20, 15, 15, 12, 8, 0, 5] },
  { id: "good-it", text: "correggi il login in src/auth/login.ts: inviare il modulo restituisce 500 invece di accedere. Aggiungi un test che lo copra e non toccare la registrazione", lang: "it", score: 75, points: [20, 15, 15, 12, 8, 0, 5] },
  { id: "full-es", text: "Objetivo:\nArreglar que `LoginView.swift` no muestre el error cuando la contraseña es incorrecta.\n\nContexto:\n- Archivo: Sources/Auth/LoginView.swift, función `submit()`.\n\nDetalle:\n- Actualmente: al fallar, la vista no cambia.\n- Esperado: aparece el mensaje \"Contraseña incorrecta\" debajo del campo.\n\nCriterio de aceptación:\n- Un test de UI con contraseña errónea encuentra el mensaje.\n\nRestricciones:\n- No toques el flujo de registro.\n- Sin dependencias nuevas.\n\nFormato de respuesta:\n- Diff resumido por archivo y resultado del test.", lang: "es", score: 100, points: [20, 15, 15, 20, 15, 10, 5] },
  { id: "prose-en", text: "In src/cart/tax.ts the VAT is applied twice when a coupon is used: a 100 € cart with a 10% coupon shows 108.9 instead of 99. Fix calculateTotal() so tax is applied once after the discount, add a unit test for that case, do not change the coupon API and reply with a short diff summary.", lang: "en", score: 85, points: [20, 15, 15, 12, 8, 10, 5] },
  { id: "short-es", text: "arregla el login", lang: "es", score: 5, points: [0, 0, 0, 0, 0, 0, 5] },
  { id: "short-en", text: "fix the login", lang: "en", score: 5, points: [0, 0, 0, 0, 0, 0, 5] },
  { id: "stuff-es", text: "Objetivo: algo. Contexto: esto. Criterio de aceptación: test. Restricciones: solo, nunca. Formato: tabla.", lang: "es", score: 50, points: [20, 8, 0, 12, 0, 10, 0] },
  { id: "stuff-en", text: "Goal: stuff. Acceptance criteria: test. Constraints: only, never. Format: table. Context: the thing.", lang: "en", score: 42, points: [20, 0, 0, 12, 0, 10, 0] },
  { id: "accept-header-only", text: "Criterio de aceptación: sí. palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra palabra ", lang: null, score: 25, points: [20, 0, 0, 0, 0, 0, 5] },
  { id: "no-compila", text: "arregla el bug, no compila y no carga", lang: "es", score: 25, points: [20, 0, 0, 0, 0, 0, 5] },
  { id: "pt-not-es", text: "no funciona el login, no carga nada", lang: "es", score: 15, points: [10, 0, 0, 0, 0, 0, 5] },
  { id: "and-or", text: "fix the login and/or signup flow please", lang: "en", score: 15, points: [10, 0, 0, 0, 0, 0, 5] },
  { id: "brands", text: "make the JavaScript bundle on iOS faster", lang: "en", score: 15, points: [10, 0, 0, 0, 0, 0, 5] },
  { id: "date", text: "desde el 04/11/2026 falla el export ES/EN", lang: "es", score: 15, points: [10, 0, 0, 0, 0, 0, 5] },
  { id: "eg", text: "retry the upload, e.g. three attempts", lang: "en", score: 23, points: [10, 0, 8, 0, 0, 0, 5] },
  { id: "chip", text: "arregla esto [Image #1]", lang: "es", score: 20, points: [10, 0, 8, 0, 0, 0, 2] },
  { id: "apostrophe", text: "only touch auth, don’t add deps", lang: null, score: 30, points: [10, 0, 0, 0, 15, 0, 5] },
  { id: "returns-not-format", text: "el endpoint devuelve 500 al guardar", lang: "es", score: 31, points: [10, 8, 8, 0, 0, 0, 5] },
  { id: "bug-description", text: "el login no funciona y la app no arranca desde ayer en el simulador", lang: "es", score: 33, points: [20, 8, 0, 0, 0, 0, 5] },
  { id: "negations-it", text: "Vincoli:\n- Non modificare il codice di produzione.\n- Non aggiungere dipendenze.", lang: "it", score: 40, points: [20, 0, 0, 0, 15, 0, 5] },
]
