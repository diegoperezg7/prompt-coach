// Borradores reales de trabajo diario: cortos, vagos, con y sin conversación previa.
type Row = { role: 'user' | 'assistant'; text: string }
// `turn`: lo que turnOf debe deducir del caso (lo comprueba bench/cases.test.ts); el banco usa el flujo de ese turno.
export const CASES: { id: string; draft: string; rows: Row[]; turn: 'new' | 'reply' | 'continue' }[] = [
  { id: 'login', draft: 'arregla el login', rows: [], turn: 'new' },
  { id: 'widget', draft: 'quiero que el widget de la app se actualice siempre que cambie el país', rows: [], turn: 'new' },
  {
    id: 'sync-offline',
    draft: 'el sync a veces pierde los gastos que meto sin conexión, míralo',
    rows: [{ role: 'user', text: 'el reconcile está en Sources/Sync/SyncService.swift, función reconcile()' }, { role: 'assistant', text: 'Visto. reconcile() borra en local lo que no devuelve el servidor.' }],
    turn: 'continue',
  },
  {
    id: 'tests-concil',
    draft: 'haz tests para lo de la conciliacion',
    rows: [{ role: 'user', text: 'he movido la lógica a backend/app/services/reconcile.py, la función reconcile_statement()' }, { role: 'assistant', text: 'Perfecto, usa pytest y fixtures en backend/tests/conftest.py.' }],
    turn: 'continue',
  },
  { id: 'home-lenta', draft: 'mejora el rendimiento de la home, va lenta', rows: [], turn: 'new' },
  {
    id: 'review-pr',
    draft: 'revisa el PR antes de mergear',
    rows: [{ role: 'user', text: 'el PR #42 toca src/store/useBudget.ts y src/pages/Budget.tsx' }, { role: 'assistant', text: 'Son 180 líneas, sobre todo el selector de totales.' }],
    turn: 'continue',
  },
  {
    id: 'refactor-tabla',
    draft: 'refactoriza el componente de la tabla que está fatal',
    rows: [{ role: 'user', text: 'src/components/DataTable.tsx tiene 600 líneas y mezcla fetch, filtros y render' }, { role: 'assistant', text: 'Sí, y no tiene tests.' }],
    turn: 'continue',
  },
  { id: 'dark-mode-en', draft: 'add dark mode to the settings page', rows: [], turn: 'new' },
  { id: 'explica-pool', draft: 'explícame cómo funciona el pooler de supabase que usamos', rows: [], turn: 'new' },
  {
    id: 'ci-en',
    draft: 'the build fails on CI, fix it',
    rows: [{ role: 'user', text: "CI log: error TS2307: Cannot find module '@/lib/api' in src/pages/Home.tsx" }, { role: 'assistant', text: 'The workflow is .github/workflows/ci.yml and runs npm run build.' }],
    turn: 'continue',
  },
  { id: 'i18n', draft: 'pon i18n en la app', rows: [], turn: 'new' },
  { id: 'arq-push', draft: 'diseña la arquitectura para el backend de notificaciones push', rows: [], turn: 'new' },
  { id: 'fr-connexion', draft: 'corrige la connexion, elle plante quand le mot de passe est vide', rows: [], turn: 'new' },
  { id: 'de-export', draft: 'der CSV-Export bricht bei Umlauten ab, bitte beheben', rows: [], turn: 'new' },
  { id: 'pt-cache', draft: 'adiciona cache na listagem de produtos que está lenta', rows: [], turn: 'new' },
  { id: 'it-test', draft: 'scrivi i test per il calcolo delle tasse nel carrello', rows: [], turn: 'new' },
  // Respuestas y continuaciones: el coach no debe repetir el contexto ni volver a la plantilla de seis secciones.
  {
    id: 'reply-opcion',
    draft: 'la segunda',
    rows: [{ role: 'user', text: 'el login falla en src/auth/session.ts' }, { role: 'assistant', text: 'Veo dos causas: el token caduca antes de tiempo o la cookie no se envía en Safari. ¿Empiezo por el token o por la cookie?' }],
    turn: 'reply',
  },
  {
    id: 'reply-en',
    draft: 'yes, but keep the old endpoint until v3',
    rows: [{ role: 'user', text: 'migrate /api/v1/orders to the new OrdersController' }, { role: 'assistant', text: 'Done in src/api/orders.ts. Should I also remove the v1 route now?' }],
    turn: 'reply',
  },
  {
    id: 'continue-igual',
    draft: 'ahora haz lo mismo en el registro',
    rows: [{ role: 'user', text: 'añade validación de email en src/forms/Login.tsx' }, { role: 'assistant', text: 'Hecho: validación con mensaje bajo el campo y test en Login.test.tsx, 4/4.' }],
    turn: 'continue',
  },
  {
    id: 'continue-rompio',
    draft: 'eso ha roto el dark mode del modal',
    rows: [{ role: 'user', text: 'cambia los colores del tema a variables CSS en src/styles/theme.css' }, { role: 'assistant', text: 'Cambiado: 14 colores pasan a --color-*. El build pasa.' }],
    turn: 'continue',
  },
]
