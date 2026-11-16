window.__ModuleLoader__.load({
  id: 'dsh-profile-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    function Section() {
      return h(
        'section',
        { style: { padding: '24px' } },
        h('h1', { style: { margin: 0, fontSize: '22px' } }, 'Плагины и скиллы'),
        h(
          'p',
          { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } },
          'Синхронизация плагинов и пользовательских скиллов через приватный репозиторий.',
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'profile-sync',
              order: 420,
              label: () => 'Плагины и скиллы',
            },
            () => h(Section),
          ),
        )
      },
    }
  },
})
