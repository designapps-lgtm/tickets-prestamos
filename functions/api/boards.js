const TABLES = ['Reservas', 'Sets', 'Usuarios']

const text = (value) => String(value ?? '').trim()
const normalizeKey = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const getValue = (row, names) => {
  const wanted = names.map(normalizeKey)
  const match = Object.entries(row || {}).find(([key]) => wanted.includes(normalizeKey(key)))
  return match?.[1] ?? ''
}
const idOf = (row, names) => text(getValue(row, names))
const sameId = (left, right) => text(left).toLowerCase() === text(right).toLowerCase()

const todayKey = () => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

const dateKey = (value) => {
  const raw = text(value)
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return iso ? `${iso[2]}/${iso[3]}/${iso[1]}` : raw
}

const readTable = async (appId, accessKey, tableName) => {
  const response = await fetch(`https://api.appsheet.com/api/v2/apps/${appId}/tables/${encodeURIComponent(tableName)}/Action`, {
    method: 'POST',
    headers: { ApplicationAccessKey: accessKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ Action: 'Find', Properties: { Locale: 'es-CO', Timezone: 'America/Bogota' }, Rows: [] }),
  })
  if (!response.ok) throw new Error(`AppSheet respondió ${response.status} para ${tableName}`)
  const payload = await response.json()
  return Array.isArray(payload) ? payload : payload.Rows || payload.rows || []
}

const buildReservations = (reservas, sets, usuarios) => {
  const setById = new Map(sets.map((row) => [idOf(row, ['SetId', 'Id']), row]))
  const userById = new Map(usuarios.map((row) => [idOf(row, ['UsuarioId', 'Id']), row]))
  const today = todayKey()

  return reservas
    .filter((row) => dateKey(getValue(row, ['Fecha', 'Date'])) === today)
    .filter((row) => !text(getValue(row, ['Estado', 'Status'])).toLowerCase().includes('cancel'))
    .map((row) => {
      const setId = idOf(row, ['SetId', 'Set'])
      const set = setById.get(setId)
      const user = userById.get(idOf(row, ['SolicitanteId', 'UsuarioId', 'Usuario']))
      const status = text(getValue(row, ['Estado', 'Status'])) || 'PENDIENTE'
      const requester = text(getValue(user, ['Nombre', 'Name'])) || 'Solicitante sin nombre'
      return {
        id: idOf(row, ['ReservaId', 'Id']),
        setId,
        start: text(getValue(row, ['HoraInicio', 'Inicio'])).slice(0, 5),
        end: text(getValue(row, ['HoraFin', 'Fin'])).slice(0, 5),
        title: `${status.toLowerCase() === 'pendiente' ? 'Bloqueado' : status} por ${requester}`,
        status,
        quantity: text(getValue(row, ['Cantidad', 'Quantity'])) || '0',
        room: text(getValue(row, ['SalonEntrega', 'Salon', 'Sala'])) || 'Sin salón',
      }
    })
    .sort((left, right) => `${left.start}${left.id}`.localeCompare(`${right.start}${right.id}`))
}

const buildBoards = (sets, reservations) => sets.map((set, index) => {
  const code = idOf(set, ['SetId', 'Id'])
  return {
    id: `set-${String.fromCharCode(97 + index)}`,
    label: code.toUpperCase().startsWith('SET-') ? `Set ${code.slice(4)}` : `Set ${String.fromCharCode(65 + index)}`,
    description: text(getValue(set, ['Nombre', 'Name'])) || 'Set de equipos',
    accent: ['blue', 'orange', 'violet'][index % 3],
    reservations: reservations.filter((reservation) => sameId(reservation.setId, code)),
  }
})

export async function onRequestGet(context) {
  const { APPSHEET_APP_ID: appId, APPSHEET_ACCESS_KEY: accessKey } = context.env
  if (!appId || !accessKey) return Response.json({ message: 'Faltan variables de AppSheet en Cloudflare Pages' }, { status: 500 })

  try {
    const rows = await Promise.all(TABLES.map((table) => readTable(appId, accessKey, table)))
    const [reservas, sets, usuarios] = rows
    const reservations = buildReservations(reservas, sets, usuarios)
    return Response.json({ boards: buildBoards(sets, reservations), reservations, date: todayKey(), source: 'appsheet' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ message: error.message }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
