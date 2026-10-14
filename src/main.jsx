import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const demoSets = [
  { id: 'set-a', label: 'Set A', description: 'Sin reservas para hoy', accent: 'blue', reservations: [] },
  { id: 'set-b', label: 'Set B', description: 'Sin reservas para hoy', accent: 'orange', reservations: [] },
  { id: 'set-c', label: 'Set C', description: 'Sin reservas para hoy', accent: 'violet', reservations: [] },
]

const loadBoards = async () => {
  const response = await fetch('/api/boards')
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message || 'No se pudo leer AppSheet')
  return payload
}

const formatDate = () => new Intl.DateTimeFormat('es-AR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date())

const timeToMinutes = (value) => {
  const [hours, minutes] = String(value || '').split(':').map(Number)
  return Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : null
}

const minutesUntil = (reservation) => {
  const start = timeToMinutes(reservation.start)
  if (start === null) return null
  const now = new Date()
  return start - (now.getHours() * 60 + now.getMinutes())
}

function Icon({ name, size = 18 }) {
  const paths = {
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.8-4L3 10" /><path d="M3 5v5h5M4 13a8 8 0 0 0 14.8 4L21 14" /><path d="M21 19v-5h-5" /></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function ReservationCard({ reservation }) {
  const minutes = minutesUntil(reservation)
  const upcoming = minutes !== null && minutes >= 0 && minutes <= 10
  return <article className={`kanban-reservation ${upcoming ? 'upcoming' : ''}`}>
    <div className="reservation-time"><strong>{reservation.start}</strong><span>{reservation.end}</span></div>
    <div className="reservation-info"><strong>{reservation.title}</strong><span>{reservation.status} · {reservation.quantity} equipos · {reservation.room}</span></div>
    {upcoming && <span className="upcoming-label">En {minutes} min</span>}
  </article>
}

function SetBoard({ set }) {
  return <section className="set-board" aria-labelledby={`${set.id}-heading`}>
    <header className="set-board-header"><div className="set-heading"><span className={`set-mark ${set.accent}`} /><div><h2 id={`${set.id}-heading`}>{set.label}</h2><p>{set.reservations.length ? `${set.reservations.length} ${set.reservations.length === 1 ? 'reserva programada' : 'reservas programadas'}` : 'Disponible todo el día'}</p></div></div><span className={`set-state ${set.reservations.length ? 'reserved' : 'available'}`}>{set.reservations.length ? 'Reservado' : 'Disponible'}</span></header>
    <div className="set-board-body">{set.reservations.length ? set.reservations.map((reservation) => <ReservationCard reservation={reservation} key={reservation.id} />) : <div className="set-empty"><span className="empty-check">✓</span><div><strong>Set disponible</strong><span>No hay reservas para este día</span></div></div>}</div>
  </section>
}

function App() {
  const [sets, setSets] = useState(demoSets)
  const [reservations, setReservations] = useState([])
  const [activeFilter, setActiveFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [connection, setConnection] = useState({ status: 'loading', message: '' })
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [reminder, setReminder] = useState(null)
  const audioContext = useRef(null)
  const alertedReservations = useRef(new Set())

  const refreshBoards = async () => {
    setConnection({ status: 'loading', message: '' })
    try {
      const payload = await loadBoards()
      setSets(payload.boards)
      setReservations(payload.reservations)
      setConnection({ status: 'connected', message: '' })
    } catch (error) {
      setSets(demoSets)
      setReservations([])
      setConnection({ status: 'error', message: error.message })
    }
  }

  const playReminder = () => {
    const context = audioContext.current
    if (!context) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    oscillator.frequency.setValueAtTime(660, context.currentTime + 0.18)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.5)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.5)
  }

  const enableSound = async () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    audioContext.current ||= new AudioContext()
    await audioContext.current.resume()
    setSoundEnabled(true)
    const next = reservations.find((reservation) => {
      const remaining = minutesUntil(reservation)
      return remaining !== null && remaining >= 0 && remaining <= 10
    })
    if (next) {
      alertedReservations.current.add(next.id)
      playReminder()
      setReminder(next)
    }
  }

  useEffect(() => { refreshBoards(); const interval = setInterval(refreshBoards, 30000); return () => clearInterval(interval) }, [])

  useEffect(() => {
    const checkReminders = () => {
      const next = reservations.find((reservation) => {
        const remaining = minutesUntil(reservation)
        return remaining !== null && remaining >= 0 && remaining <= 10 && !alertedReservations.current.has(reservation.id)
      })
      if (!next) return
      alertedReservations.current.add(next.id)
      if (soundEnabled) playReminder()
      setReminder(next)
    }
    checkReminders()
    const interval = setInterval(checkReminders, 15000)
    return () => clearInterval(interval)
  }, [reservations, soundEnabled])

  const filteredSets = useMemo(() => sets.filter((set) => activeFilter === 'all' || set.id === activeFilter).map((set) => ({
    ...set,
    reservations: set.reservations.filter((reservation) => `${reservation.title} ${reservation.set} ${reservation.room}`.toLowerCase().includes(query.toLowerCase())),
  })), [sets, activeFilter, query])

  return <div className="app-shell">
    <main className="main-content" id="reservas">
      <header className="topbar"><div className="breadcrumb"><span>Operación</span><Icon name="chevron" size={14} /><strong>Reservas</strong></div><div className="date-display"><Icon name="calendar" size={17} /><span>{formatDate()}</span></div></header>
      <div className="content-wrap">
        <section className="intro"><div><p className="eyebrow">CONTROL DE PRÉSTAMOS / AGENDA DEL DÍA</p><h1>Reservas de hoy</h1><p className="intro-copy">Cada set muestra sus reservas programadas. Si no hay una reserva, queda disponible para operar.</p></div><div className="intro-actions"><button className={`sound-button ${soundEnabled ? 'enabled' : ''}`} onClick={enableSound}><Icon name="bell" size={16} />{soundEnabled ? 'Alertas activas' : 'Activar timbre'}</button><button className="refresh-button" onClick={refreshBoards} disabled={connection.status === 'loading'}><Icon name="refresh" size={16} />{connection.status === 'loading' ? 'Conectando...' : 'Actualizar datos'}</button></div></section>
        {connection.status === 'error' && <div className="connection-alert" role="alert"><strong>No se pudo actualizar AppSheet.</strong><span>{connection.message}</span><button onClick={refreshBoards}>Reintentar</button></div>}
        {connection.status === 'loading' && <div className="loading-state" role="status"><span className="loading-spinner" />Consultando las reservas de hoy en AppSheet...</div>}
        {reminder && <div className="reminder-alert" role="alert"><Icon name="bell" size={17} /><div><strong>Reserva próxima, {reminder.start}</strong><span>{reminder.title} · {reminder.set} · {reminder.room}</span></div><button onClick={() => setReminder(null)} aria-label="Cerrar recordatorio">Cerrar</button></div>}
        <section className="summary-strip" aria-label="Resumen de reservas"><div className="summary-main"><span className="summary-number">{reservations.length}</span><span className="summary-label">reservas activas hoy</span></div><div className="summary-separator" /><div className="summary-context"><span className="summary-kicker">SETS OCUPADOS</span><strong>{sets.filter((set) => set.reservations.length).length} de {sets.length}</strong></div><div className="summary-context"><span className="summary-kicker">AVISO</span><strong>10 min antes</strong></div></section>
        <div className="toolbar"><div className="filter-tabs" role="tablist" aria-label="Filtrar sets">{[['all', 'Todos'], ...sets.map((set) => [set.id, set.label])].map(([id, label]) => <button key={id} className={activeFilter === id ? 'filter-tab selected' : 'filter-tab'} onClick={() => setActiveFilter(id)} role="tab" aria-selected={activeFilter === id}>{label}</button>)}</div><label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar reserva, salón o profesor" aria-label="Buscar reserva, salón o profesor" /></label></div>
        <div className="boards horizontal-boards" id="sets">{filteredSets.length ? filteredSets.map((set) => <SetBoard set={set} key={set.id} />) : <div className="global-empty"><strong>No encontramos reservas</strong><span>Probá con otro nombre, salón o set.</span></div>}</div>
        <footer className="page-footer"><span>{connection.status === 'connected' ? 'Datos sincronizados desde AppSheet' : 'Datos de demostración, no representan reservas reales'}</span><span>Lectura en tiempo real cada 30 segundos · Sin acciones de escritura</span></footer>
      </div>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
