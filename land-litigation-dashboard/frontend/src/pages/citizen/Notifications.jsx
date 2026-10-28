import { Card, Empty } from '../../components/ui.jsx'
import { Bell, RefreshCw, Scale, Clock, CheckCircle2, Info, X, CheckCheck } from 'lucide-react'

const ICON_MAP = {
  tracking: Bell,
  status: RefreshCw,
  hearing: Scale,
  adjournment: Clock,
  disposal: CheckCircle2,
  info: Info,
}

export default function Notifications({ items, onRead, onReadAll, onDelete }) {
  const unread = items.filter((n) => !n.is_read).length

  return (
    <Card
      title={`Notifications${unread ? ` (${unread} new)` : ''}`}
      right={
        unread > 0 && (
          <button className="btn btn-outline btn-sm" onClick={onReadAll} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCheck size={14} />
            Mark all read
          </button>
        )
      }
    >
      {items.length === 0 ? (
        <Empty>No notifications yet. Track a case and you will be alerted here when it changes.</Empty>
      ) : (
        <ul className="notif-list">
          {items.map((n) => {
            const IconComponent = ICON_MAP[n.kind] || Info
            return (
              <li key={n.id} className={n.is_read ? '' : 'unread'}>
                <span className="n-icon">
                  <IconComponent size={16} />
                </span>
                <div className="n-body" onClick={() => !n.is_read && onRead(n.id)}>
                  <b>{n.title}</b>
                  <p>{n.message}</p>
                  <small>{new Date(n.created_at).toLocaleString('en-IN')}</small>
                </div>
                <button className="icon-btn" title="Delete" onClick={() => onDelete(n.id)}>
                  <X size={15} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
