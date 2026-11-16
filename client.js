window.__ModuleLoader__.load({
  id: 'dsh-profile-sync',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    const API = '/profile-sync/api'

    async function api(path, options = {}) {
      const response = await fetch(API + path, {
        headers: { 'content-type': 'application/json' },
        ...options,
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`)
      return body
    }

    const actionLabel = {
      same: 'без изменений',
      new: 'добавить',
      update: 'обновить',
      'local-only': 'только здесь',
      conflict: 'конфликт',
    }

    function Badge({ action }) {
      const color = action === 'conflict' ? '#d93025' : action === 'new' || action === 'update' ? '#0b7a3b' : '#6b7280'
      return h(
        'span',
        { style: { color, fontSize: '12px', fontWeight: 600 } },
        actionLabel[action] || action,
      )
    }

    function Section() {
      const [status, setStatus] = useState(null)
      const [devices, setDevices] = useState([])
      const [selected, setSelected] = useState('')
      const [diff, setDiff] = useState(null)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')

      async function refresh() {
        const next = await api('/status')
        setStatus(next)
        try {
          const list = await api('/devices')
          setDevices(list.devices || [])
        } catch (error) {
          setMessage(error.message)
        }
      }

      useEffect(() => {
        refresh().catch(error => setMessage(error.message))
      }, [])

      async function syncNow() {
        setBusy(true)
        setMessage('')
        try {
          const result = await api('/snapshot', { method: 'POST', body: '{}' })
          setMessage(`Снимок создан: ${result.commit?.sha?.slice(0, 8) || 'ok'}`)
          await refresh()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(false)
        }
      }

      async function choose(deviceId) {
        setSelected(deviceId)
        setDiff(null)
        if (!deviceId) return
        setBusy(true)
        try {
          const result = await api(`/diff?device=${encodeURIComponent(deviceId)}`)
          setDiff(result.diff)
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(false)
        }
      }

      async function restartNow() {
        if (!window.confirm('Перезапустить DSH сейчас?')) return
        setBusy(true)
        try {
          await api('/restart', { method: 'POST', body: '{}' })
          setMessage('DSH перезапускается…')
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(false)
        }
      }

      async function applyNow() {
        if (!selected) return
        if (!window.confirm('Применить выбранный снимок? Перед изменением будет создан backup.')) return
        setBusy(true)
        setMessage('')
        try {
          const result = await api('/apply', { method: 'POST', body: JSON.stringify({ deviceId: selected }) })
          setMessage(`Применено. Backup: ${result.backupDir || 'создан'}. Перезапустите DSH.`)
          await refresh()
        } catch (error) {
          setMessage(error.message)
        } finally {
          setBusy(false)
        }
      }

      const otherDevices = devices.filter(device => !device.current)
      const card = {
        border: '1px solid var(--dsw-alias-separator)',
        borderRadius: '12px',
        padding: '16px',
        marginTop: '14px',
      }
      const button = {
        border: '1px solid var(--dsw-alias-separator)',
        borderRadius: '8px',
        padding: '8px 12px',
        cursor: busy ? 'wait' : 'pointer',
        background: 'var(--dsw-alias-fill-secondary)',
        color: 'inherit',
      }
      const row = {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr 100px',
        gap: '8px',
        padding: '7px 0',
        borderTop: '1px solid var(--dsw-alias-separator)',
        fontSize: '13px',
        alignItems: 'center',
      }

      return h(
        'section',
        { style: { padding: '24px', maxWidth: '920px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } },
          h('div', null,
            h('div', { style: { fontSize: '11px', letterSpacing: '0.12em', color: 'var(--dsw-alias-label-secondary)' } }, 'ПРОФИЛЬ — ВЕЗДЕ'),
            h('h1', { style: { margin: '4px 0', fontSize: '24px' } }, 'Плагины и скиллы'),
            h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '13px' } },
              'Только плагины и пользовательские скиллы. Настройки и ключи не синхронизируются.'),
          ),
          h('button', { style: button, disabled: busy, onClick: syncNow }, busy ? 'Работаю…' : 'Синхронизировать'),
        ),
        message ? h('div', { style: { ...card, color: message.includes('Backup') ? '#0b7a3b' : '#b45309' } },
          h('span', null, message),
          message.includes('Backup') ? h('button', { style: { ...button, marginLeft: '12px' }, disabled: busy, onClick: restartNow }, 'Перезапустить DSH') : null,
        ) : null,
        status ? h('div', { style: card },
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' } },
            h('div', null, h('div', { style: { fontSize: '12px', opacity: 0.7 } }, 'Устройство'), h('strong', null, status.device?.deviceName || '—')),
            h('div', null, h('div', { style: { fontSize: '12px', opacity: 0.7 } }, 'Плагинов'), h('strong', null, status.local?.plugins ?? '—')),
            h('div', null, h('div', { style: { fontSize: '12px', opacity: 0.7 } }, 'Скиллов'), h('strong', null, status.local?.skills ?? '—')),
          ),
          h('div', { style: { marginTop: '10px', fontSize: '12px', opacity: 0.7 } }, status.remote),
        ) : null,
        h('div', { style: card },
          h('h2', { style: { margin: 0, fontSize: '16px' } }, 'Снимки других компьютеров'),
          otherDevices.length === 0
            ? h('p', { style: { opacity: 0.7, fontSize: '13px' } },
              devices.length === 0
                ? 'Пока нет снимков. Нажмите «Синхронизировать» на этом ПК.'
                : 'Снимок этого ПК создан. Снимков других компьютеров пока нет.')
            : null,
          h('select', {
            value: selected,
            onChange: event => choose(event.target.value),
            style: { ...button, width: '100%', marginTop: '10px' },
          },
            h('option', { value: '' }, 'Выберите устройство'),
            otherDevices.map(device =>
              h('option', { key: device.deviceId, value: device.deviceId },
                `${device.deviceName} · ${device.plugins} плагинов · ${device.skills} скиллов`),
            ),
          ),
          diff ? h('div', { style: { marginTop: '12px' } },
            diff.warnings?.map((warning, index) => h('div', { key: index, style: { color: '#b45309', fontSize: '13px' } }, warning)),
            !diff.compatible ? h('div', { style: { color: '#d93025', fontSize: '13px' } }, 'Несовместимая версия DSH: применение заблокировано.') : null,
            h('h3', { style: { fontSize: '14px', marginBottom: '4px' } }, 'Плагины'),
            diff.plugins.map(plugin => h('div', { key: plugin.name, style: row },
              h('span', null, plugin.name),
              h('span', { style: { opacity: 0.7 } }, plugin.local?.version || plugin.local?.spec || '—'),
              h('span', { style: { opacity: 0.7 } }, plugin.remote?.version || plugin.remote?.spec || '—'),
              h(Badge, { action: plugin.action }),
            )),
            h('h3', { style: { fontSize: '14px', marginBottom: '4px', marginTop: '12px' } }, 'Скиллы'),
            diff.skills.map(skill => h('div', { key: skill.name, style: row },
              h('span', null, skill.name),
              h('span', { style: { opacity: 0.7 } }, skill.local ? 'есть' : '—'),
              h('span', { style: { opacity: 0.7 } }, skill.remote ? 'есть' : '—'),
              h(Badge, { action: skill.action }),
            )),
            h('button', {
              style: { ...button, marginTop: '12px', opacity: busy || !diff.compatible ? 0.5 : 1 },
              disabled: busy || !diff.compatible,
              onClick: applyNow,
            }, 'Применить выбранный снимок'),
          ) : null,
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
