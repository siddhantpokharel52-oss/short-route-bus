import { Routes, Route } from 'react-router-dom'
import PublicLayout from './components/PublicLayout'
import HomePage from './pages/HomePage'
import RoutesPage from './pages/RoutesPage'
import StopsPage from './pages/StopsPage'
import FaresPage from './pages/FaresPage'
import TicketVerifyPage from './pages/TicketVerifyPage'
import ComplaintsPage from './pages/ComplaintsPage'
import SmartCardPage from './pages/SmartCardPage'

export default function PublicApp() {
  return (
    <PublicLayout>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="routes" element={<RoutesPage />} />
        <Route path="stops" element={<StopsPage />} />
        <Route path="fares" element={<FaresPage />} />
        <Route path="verify-ticket" element={<TicketVerifyPage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="smart-card" element={<SmartCardPage />} />
      </Routes>
    </PublicLayout>
  )
}
