// Borradores reales de trabajo diario: cortos, vagos, con y sin conversación previa.
export const CASES: { id: string; draft: string; context: string }[] = [
  { id: 'login', draft: 'arregla el login', context: '' },
  { id: 'widget', draft: 'quiero que el widget de la app se actualice siempre que cambie el país', context: '' },
  {
    id: 'sync-offline',
    draft: 'el sync a veces pierde los gastos que meto sin conexión, míralo',
    context: 'Conversación reciente (el agente ya la conoce):\nuser: el reconcile está en Sources/Sync/SyncService.swift, función reconcile()\nassistant: Visto. reconcile() borra en local lo que no devuelve el servidor.',
  },
  {
    id: 'tests-concil',
    draft: 'haz tests para lo de la conciliacion',
    context: 'Conversación reciente (el agente ya la conoce):\nuser: he movido la lógica a backend/app/services/reconcile.py, la función reconcile_statement()\nassistant: Perfecto, usa pytest y fixtures en backend/tests/conftest.py.',
  },
  { id: 'home-lenta', draft: 'mejora el rendimiento de la home, va lenta', context: '' },
  {
    id: 'review-pr',
    draft: 'revisa el PR antes de mergear',
    context: 'Conversación reciente (el agente ya la conoce):\nuser: el PR #42 toca src/store/useBudget.ts y src/pages/Budget.tsx\nassistant: Son 180 líneas, sobre todo el selector de totales.',
  },
  {
    id: 'refactor-tabla',
    draft: 'refactoriza el componente de la tabla que está fatal',
    context: 'Conversación reciente (el agente ya la conoce):\nuser: src/components/DataTable.tsx tiene 600 líneas y mezcla fetch, filtros y render\nassistant: Sí, y no tiene tests.',
  },
  { id: 'dark-mode-en', draft: 'add dark mode to the settings page', context: '' },
  { id: 'explica-pool', draft: 'explícame cómo funciona el pooler de supabase que usamos', context: '' },
  {
    id: 'ci-en',
    draft: 'the build fails on CI, fix it',
    context: "Recent conversation (the agent already knows it):\nuser: CI log: error TS2307: Cannot find module '@/lib/api' in src/pages/Home.tsx\nassistant: The workflow is .github/workflows/ci.yml and runs npm run build.",
  },
  { id: 'i18n', draft: 'pon i18n en la app', context: '' },
  { id: 'arq-push', draft: 'diseña la arquitectura para el backend de notificaciones push', context: '' },
]
