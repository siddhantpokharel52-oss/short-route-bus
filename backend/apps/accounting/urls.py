from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register("accounts", views.ChartOfAccountViewSet, basename="coa")
router.register("journal-entries", views.JournalEntryViewSet, basename="journal-entry")
router.register("salary-payments", views.SalaryPaymentViewSet, basename="salary-payment")

urlpatterns = [
    path("", include(router.urls)),
    # Dashboard
    path("dashboard/", views.DashboardSummaryView.as_view(), name="accounting-dashboard"),
    # Reports
    path("reports/general-ledger/", views.GeneralLedgerView.as_view(), name="general-ledger"),
    path("reports/trial-balance/", views.TrialBalanceView.as_view(), name="trial-balance"),
    path("reports/profit-loss/", views.ProfitLossView.as_view(), name="profit-loss"),
    path("reports/balance-sheet/", views.BalanceSheetView.as_view(), name="balance-sheet"),
    path("reports/cash-flow/", views.CashFlowView.as_view(), name="cash-flow"),
    path("reports/income-by-route/", views.IncomeByRouteView.as_view(), name="income-by-route"),
    path("reports/expense-analysis/", views.ExpenseAnalysisView.as_view(), name="expense-analysis"),
]
