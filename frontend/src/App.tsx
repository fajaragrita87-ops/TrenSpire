import { Navigate, Route, Routes } from 'react-router-dom'

import { useAuthStore } from './lib/auth'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import ProfitsLossDashboardPage from './pages/ProfitsLossDashboardPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/pnl" element={<ProfitsLossDashboardPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
