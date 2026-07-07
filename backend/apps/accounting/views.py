from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Sum, Q
from django.utils import timezone
from decimal import Decimal
import datetime

from .models import ChartOfAccount, JournalEntry, JournalEntryLine, SalaryPayment
from .serializers import (
    ChartOfAccountSerializer,
    ChartOfAccountTreeSerializer,
    JournalEntrySerializer,
    SalaryPaymentSerializer,
)
from backend.apps.users.permissions import IsFinanceRole


class ChartOfAccountViewSet(viewsets.ModelViewSet):
    permission_classes = [IsFinanceRole]
    queryset = ChartOfAccount.objects.filter(is_active=True).order_by("code")
    serializer_class = ChartOfAccountSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["code", "name"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if atype := params.get("account_type"):
            qs = qs.filter(account_type=atype)
        if is_group := params.get("is_group"):
            qs = qs.filter(is_group=is_group.lower() in ("true", "1"))
        return qs

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.is_system:
            return Response(
                {"detail": "System accounts cannot be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if obj.children.filter(is_active=True).exists():
            return Response(
                {"detail": "Cannot delete a group account that still has child accounts."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if obj.journal_lines.exists():
            return Response(
                {"detail": "Account has posted transactions and cannot be deleted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        obj.is_active = False
        obj.save(update_fields=["is_active"])
        # If parent now has no more active children, un-mark it as group
        if obj.parent_id:
            parent = ChartOfAccount.objects.filter(pk=obj.parent_id).first()
            if parent and not parent.children.filter(is_active=True).exists():
                parent.is_group = False
                parent.is_posting_allowed = True
                parent.save(update_fields=["is_group", "is_posting_allowed"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="tree")
    def tree(self, request):
        """Return the full COA as a nested tree starting from root accounts."""
        roots = (
            ChartOfAccount.objects.filter(parent__isnull=True, is_active=True)
            .order_by("code")
        )
        data = ChartOfAccountTreeSerializer(roots, many=True).data
        return Response(data)

    @action(detail=True, methods=["post"], url_path="move")
    def move(self, request, pk=None):
        """Move an account to a different parent (or to root if parent_id is null)."""
        account = self.get_object()
        if account.is_system:
            return Response(
                {"detail": "System accounts cannot be moved."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_parent_id = request.data.get("parent_id")

        if new_parent_id:
            try:
                new_parent = ChartOfAccount.objects.get(pk=new_parent_id, is_active=True)
            except ChartOfAccount.DoesNotExist:
                return Response(
                    {"detail": "Target parent account not found."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Circular reference guard: traverse up from new_parent
            node = new_parent
            while node is not None:
                if str(node.pk) == str(account.pk):
                    return Response(
                        {"detail": "Cannot move an account under one of its own descendants."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                node = node.parent if node.parent_id else None

            old_parent_id = account.parent_id
            account.parent = new_parent
            account.save()  # save() recalculates level_no and propagates is_group upward

            # If old parent no longer has active children, un-group it
            if old_parent_id and old_parent_id != new_parent_id:
                old_parent = ChartOfAccount.objects.filter(pk=old_parent_id).first()
                if old_parent and not old_parent.children.filter(is_active=True).exists():
                    old_parent.is_group = False
                    old_parent.is_posting_allowed = True
                    old_parent.save(update_fields=["is_group", "is_posting_allowed"])
        else:
            old_parent_id = account.parent_id
            account.parent = None
            account.save()
            if old_parent_id:
                old_parent = ChartOfAccount.objects.filter(pk=old_parent_id).first()
                if old_parent and not old_parent.children.filter(is_active=True).exists():
                    old_parent.is_group = False
                    old_parent.is_posting_allowed = True
                    old_parent.save(update_fields=["is_group", "is_posting_allowed"])

        return Response(ChartOfAccountSerializer(account).data)

    @action(detail=False, methods=["get"], url_path="by-type")
    def by_type(self, request):
        """Return accounts grouped by AccountType."""
        result = {}
        for atype in ChartOfAccount.AccountType:
            qs = ChartOfAccount.objects.filter(account_type=atype, is_active=True).order_by("code")
            result[atype.value] = ChartOfAccountSerializer(qs, many=True).data
        return Response(result)


class JournalEntryViewSet(viewsets.ModelViewSet):
    permission_classes = [IsFinanceRole]
    queryset = JournalEntry.objects.prefetch_related("lines__account").all()
    serializer_class = JournalEntrySerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["entry_no", "description", "reference_no"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if status_filter := params.get("status"):
            qs = qs.filter(status=status_filter)
        if source := params.get("source_type"):
            qs = qs.filter(source_type=source)
        if date_from := params.get("date_from"):
            qs = qs.filter(date__gte=date_from)
        if date_to := params.get("date_to"):
            qs = qs.filter(date__lte=date_to)
        return qs

    @action(detail=True, methods=["post"], url_path="post")
    def post_entry(self, request, pk=None):
        je = self.get_object()
        if je.status != JournalEntry.Status.DRAFT:
            return Response(
                {"detail": "Only DRAFT entries can be posted."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if je.total_debit != je.total_credit:
            return Response(
                {"detail": f"Entry does not balance: Dr {je.total_debit} ≠ Cr {je.total_credit}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        je.status = JournalEntry.Status.POSTED
        je.save(update_fields=["status"])
        from backend.apps.accounting.signals import _update_balances
        _update_balances(je)
        return Response(JournalEntrySerializer(je).data)

    @action(detail=True, methods=["post"], url_path="reverse")
    def reverse_entry(self, request, pk=None):
        original = self.get_object()
        if original.status != JournalEntry.Status.POSTED:
            return Response(
                {"detail": "Only POSTED entries can be reversed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        rev_date = request.data.get("date", str(timezone.now().date()))
        rev_entry_no = JournalEntry.generate_entry_no(
            datetime.date.fromisoformat(rev_date)
        )
        reversal = JournalEntry.objects.create(
            entry_no=rev_entry_no,
            date=rev_date,
            description=f"Reversal of {original.entry_no}: {original.description}",
            status=JournalEntry.Status.POSTED,
            source_type=original.source_type,
            source_id=original.source_id,
            reference_no=f"REV-{original.entry_no}",
            reversed_entry=original,
        )
        for line in original.lines.all():
            JournalEntryLine.objects.create(
                journal_entry=reversal,
                account=line.account,
                description=f"Reversal: {line.description}",
                debit=line.credit,   # swap debit/credit
                credit=line.debit,
                vehicle_id=line.vehicle_id,
                route_id=line.route_id,
            )
        original.status = JournalEntry.Status.REVERSED
        original.save(update_fields=["status"])
        from backend.apps.accounting.signals import _update_balances
        _update_balances(reversal)
        return Response(JournalEntrySerializer(reversal).data, status=status.HTTP_201_CREATED)


class SalaryPaymentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsFinanceRole]
    queryset = SalaryPayment.objects.all()
    serializer_class = SalaryPaymentSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ["employee_name"]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if emp_type := params.get("employee_type"):
            qs = qs.filter(employee_type=emp_type)
        if status_f := params.get("status"):
            qs = qs.filter(status=status_f)
        return qs

    @action(detail=True, methods=["post"], url_path="pay")
    def pay(self, request, pk=None):
        sp = self.get_object()
        if sp.status == SalaryPayment.Status.PAID:
            return Response({"detail": "Already paid."}, status=status.HTTP_400_BAD_REQUEST)
        sp.status = SalaryPayment.Status.PAID
        sp.save()  # triggers signal → creates JE
        return Response(SalaryPaymentSerializer(sp).data)


# ─── Report Views ────────────────────────────────────────────────────────────

class GeneralLedgerView(APIView):
    """
    GET /accounting/reports/general-ledger/
    Params: account_id, date_from, date_to
    """
    permission_classes = [IsFinanceRole]

    def get(self, request):
        params = request.query_params
        qs = JournalEntryLine.objects.filter(
            journal_entry__status=JournalEntry.Status.POSTED
        ).select_related("journal_entry", "account")

        if acct := params.get("account_id"):
            qs = qs.filter(account_id=acct)
        if date_from := params.get("date_from"):
            qs = qs.filter(journal_entry__date__gte=date_from)
        if date_to := params.get("date_to"):
            qs = qs.filter(journal_entry__date__lte=date_to)

        qs = qs.order_by("account__code", "journal_entry__date", "journal_entry__entry_no")

        rows = []
        running = {}
        for line in qs:
            code = line.account.code
            if code not in running:
                running[code] = Decimal("0")
            if line.account.is_debit_normal:
                running[code] += line.debit - line.credit
            else:
                running[code] += line.credit - line.debit
            rows.append({
                "account_code": code,
                "account_name": line.account.name,
                "date": line.journal_entry.date,
                "entry_no": line.journal_entry.entry_no,
                "description": line.description or line.journal_entry.description,
                "debit": str(line.debit),
                "credit": str(line.credit),
                "balance": str(running[code]),
            })

        return Response({"ledger": rows})


class TrialBalanceView(APIView):
    """
    GET /accounting/reports/trial-balance/
    Params: date (defaults to today)
    """
    permission_classes = [IsFinanceRole]

    def get(self, request):
        as_of = request.query_params.get("date", str(timezone.now().date()))

        rows = []
        total_dr = Decimal("0")
        total_cr = Decimal("0")

        for acct in ChartOfAccount.objects.filter(is_active=True).order_by("code"):
            lines = JournalEntryLine.objects.filter(
                account=acct,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__lte=as_of,
            )
            dr = lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
            cr = lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")
            if not dr and not cr:
                continue
            rows.append({
                "code": acct.code,
                "name": acct.name,
                "account_type": acct.account_type,
                "debit": str(dr),
                "credit": str(cr),
            })
            total_dr += dr
            total_cr += cr

        return Response({
            "as_of": as_of,
            "rows": rows,
            "total_debit": str(total_dr),
            "total_credit": str(total_cr),
            "balanced": total_dr == total_cr,
        })


class ProfitLossView(APIView):
    """
    GET /accounting/reports/profit-loss/
    Params: date_from, date_to
    """
    permission_classes = [IsFinanceRole]

    def get(self, request):
        params = request.query_params
        date_from = params.get("date_from", str(timezone.now().date().replace(day=1)))
        date_to = params.get("date_to", str(timezone.now().date()))

        def _sum(account_type, sub_codes=None):
            qs = JournalEntryLine.objects.filter(
                account__account_type=account_type,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
            )
            if sub_codes:
                qs = qs.filter(account__code__in=sub_codes)
            dr = qs.aggregate(t=Sum("debit"))["t"] or Decimal("0")
            cr = qs.aggregate(t=Sum("credit"))["t"] or Decimal("0")
            # Income increases with credit; Expense increases with debit
            if account_type == "INCOME":
                return cr - dr
            return dr - cr

        # Breakdown by account
        income_accounts = ChartOfAccount.objects.filter(
            account_type="INCOME", is_active=True
        ).order_by("code")
        expense_accounts = ChartOfAccount.objects.filter(
            account_type="EXPENSE", is_active=True
        ).order_by("code")

        def _acct_total(acct, account_type):
            qs = JournalEntryLine.objects.filter(
                account=acct,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
            )
            dr = qs.aggregate(t=Sum("debit"))["t"] or Decimal("0")
            cr = qs.aggregate(t=Sum("credit"))["t"] or Decimal("0")
            return (cr - dr) if account_type == "INCOME" else (dr - cr)

        income_rows = [
            {"code": a.code, "name": a.name, "amount": str(_acct_total(a, "INCOME"))}
            for a in income_accounts
        ]
        expense_rows = [
            {"code": a.code, "name": a.name, "amount": str(_acct_total(a, "EXPENSE"))}
            for a in expense_accounts
        ]

        total_income = sum(Decimal(r["amount"]) for r in income_rows)
        total_expense = sum(Decimal(r["amount"]) for r in expense_rows)
        net_profit = total_income - total_expense

        return Response({
            "date_from": date_from,
            "date_to": date_to,
            "income": income_rows,
            "expenses": expense_rows,
            "total_income": str(total_income),
            "total_expenses": str(total_expense),
            "net_profit": str(net_profit),
        })


class BalanceSheetView(APIView):
    """
    GET /accounting/reports/balance-sheet/
    Params: date (defaults to today)
    """
    permission_classes = [IsFinanceRole]

    def get(self, request):
        as_of = request.query_params.get("date", str(timezone.now().date()))

        def _section(account_type):
            qs = ChartOfAccount.objects.filter(
                account_type=account_type, is_active=True
            ).order_by("code")
            rows = []
            total = Decimal("0")
            for acct in qs:
                lines = JournalEntryLine.objects.filter(
                    account=acct,
                    journal_entry__status=JournalEntry.Status.POSTED,
                    journal_entry__date__lte=as_of,
                )
                dr = lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
                cr = lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")
                if account_type == "ASSET":
                    bal = dr - cr
                elif account_type in ("LIABILITY", "EQUITY"):
                    bal = cr - dr
                else:
                    bal = Decimal("0")
                rows.append({"code": acct.code, "name": acct.name, "balance": str(bal)})
                total += bal
            return rows, total

        asset_rows, total_assets = _section("ASSET")
        liab_rows, total_liab = _section("LIABILITY")
        eq_rows, total_eq = _section("EQUITY")

        # Retained earnings = cumulative net profit (income - expense) up to as_of
        income_lines = JournalEntryLine.objects.filter(
            account__account_type="INCOME",
            journal_entry__status=JournalEntry.Status.POSTED,
            journal_entry__date__lte=as_of,
        )
        expense_lines = JournalEntryLine.objects.filter(
            account__account_type="EXPENSE",
            journal_entry__status=JournalEntry.Status.POSTED,
            journal_entry__date__lte=as_of,
        )
        total_income_cr = income_lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")
        total_income_dr = income_lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
        total_exp_dr = expense_lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
        total_exp_cr = expense_lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")
        current_earnings = (total_income_cr - total_income_dr) - (total_exp_dr - total_exp_cr)

        return Response({
            "as_of": as_of,
            "assets": {"rows": asset_rows, "total": str(total_assets)},
            "liabilities": {"rows": liab_rows, "total": str(total_liab)},
            "equity": {
                "rows": eq_rows,
                "current_year_earnings": str(current_earnings),
                "total": str(total_eq + current_earnings),
            },
            "total_liabilities_equity": str(total_liab + total_eq + current_earnings),
        })


class CashFlowView(APIView):
    """
    GET /accounting/reports/cash-flow/
    Params: date_from, date_to
    Simple indirect method: operating cash = net profit + non-cash items.
    """
    permission_classes = [IsFinanceRole]

    def get(self, request):
        params = request.query_params
        date_from = params.get("date_from", str(timezone.now().date().replace(day=1)))
        date_to = params.get("date_to", str(timezone.now().date()))

        cash_accounts = ["1110", "1120"]  # Cash in Hand + Cash at Bank

        def _cash_movement(codes):
            inflows = (
                JournalEntryLine.objects.filter(
                    account__code__in=codes,
                    journal_entry__status=JournalEntry.Status.POSTED,
                    journal_entry__date__gte=date_from,
                    journal_entry__date__lte=date_to,
                ).aggregate(t=Sum("debit"))["t"] or Decimal("0")
            )
            outflows = (
                JournalEntryLine.objects.filter(
                    account__code__in=codes,
                    journal_entry__status=JournalEntry.Status.POSTED,
                    journal_entry__date__gte=date_from,
                    journal_entry__date__lte=date_to,
                ).aggregate(t=Sum("credit"))["t"] or Decimal("0")
            )
            return inflows, outflows

        ticket_inflow = (
            JournalEntryLine.objects.filter(
                account__code__in=cash_accounts,
                journal_entry__source_type=JournalEntry.SourceType.TICKET,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
            ).aggregate(t=Sum("debit"))["t"] or Decimal("0")
        )

        fuel_out = (
            JournalEntryLine.objects.filter(
                account__code="5100",
                journal_entry__source_type=JournalEntry.SourceType.FUEL,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
            ).aggregate(t=Sum("debit"))["t"] or Decimal("0")
        )

        maint_out = (
            JournalEntryLine.objects.filter(
                account__code="5200",
                journal_entry__source_type=JournalEntry.SourceType.MAINTENANCE,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
            ).aggregate(t=Sum("debit"))["t"] or Decimal("0")
        )

        salary_out = (
            JournalEntryLine.objects.filter(
                account__code__in=cash_accounts,
                journal_entry__source_type=JournalEntry.SourceType.SALARY,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
            ).aggregate(t=Sum("credit"))["t"] or Decimal("0")
        )

        total_in, total_out = _cash_movement(cash_accounts)
        net_cash = total_in - total_out

        return Response({
            "date_from": date_from,
            "date_to": date_to,
            "operating": {
                "ticket_collections": str(ticket_inflow),
                "fuel_payments": str(fuel_out),
                "maintenance_payments": str(maint_out),
                "salary_payments": str(salary_out),
            },
            "total_cash_inflow": str(total_in),
            "total_cash_outflow": str(total_out),
            "net_cash_flow": str(net_cash),
        })


class IncomeByRouteView(APIView):
    """GET /accounting/reports/income-by-route/"""
    permission_classes = [IsFinanceRole]

    def get(self, request):
        params = request.query_params
        date_from = params.get("date_from", str(timezone.now().date().replace(day=1)))
        date_to = params.get("date_to", str(timezone.now().date()))

        rows = (
            JournalEntryLine.objects.filter(
                account__account_type="INCOME",
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
                route_id__isnull=False,
            )
            .values("route_id")
            .annotate(total_credit=Sum("credit"), total_debit=Sum("debit"))
        )

        data = [
            {
                "route_id": str(r["route_id"]),
                "income": str((r["total_credit"] or Decimal("0")) - (r["total_debit"] or Decimal("0"))),
            }
            for r in rows
        ]
        return Response({"date_from": date_from, "date_to": date_to, "rows": data})


class ExpenseAnalysisView(APIView):
    """GET /accounting/reports/expense-analysis/"""
    permission_classes = [IsFinanceRole]

    def get(self, request):
        params = request.query_params
        date_from = params.get("date_from", str(timezone.now().date().replace(day=1)))
        date_to = params.get("date_to", str(timezone.now().date()))

        accounts = ChartOfAccount.objects.filter(
            account_type="EXPENSE", is_active=True
        ).order_by("code")

        rows = []
        for acct in accounts:
            qs = JournalEntryLine.objects.filter(
                account=acct,
                journal_entry__status=JournalEntry.Status.POSTED,
                journal_entry__date__gte=date_from,
                journal_entry__date__lte=date_to,
            )
            dr = qs.aggregate(t=Sum("debit"))["t"] or Decimal("0")
            cr = qs.aggregate(t=Sum("credit"))["t"] or Decimal("0")
            rows.append({
                "code": acct.code,
                "name": acct.name,
                "amount": str(dr - cr),
            })

        total = sum(Decimal(r["amount"]) for r in rows)
        return Response({
            "date_from": date_from,
            "date_to": date_to,
            "expenses": rows,
            "total": str(total),
        })


class DashboardSummaryView(APIView):
    """
    GET /accounting/dashboard/
    Quick KPIs: total revenue MTD, total expenses MTD, net profit, cash balance.
    """
    permission_classes = [IsFinanceRole]

    def get(self, request):
        today = timezone.now().date()
        month_start = today.replace(day=1)

        def _sum_posted_lines(account_type, date_from=None, date_to=None):
            qs = JournalEntryLine.objects.filter(
                account__account_type=account_type,
                journal_entry__status=JournalEntry.Status.POSTED,
            )
            if date_from:
                qs = qs.filter(journal_entry__date__gte=date_from)
            if date_to:
                qs = qs.filter(journal_entry__date__lte=date_to)
            dr = qs.aggregate(t=Sum("debit"))["t"] or Decimal("0")
            cr = qs.aggregate(t=Sum("credit"))["t"] or Decimal("0")
            return (cr - dr) if account_type == "INCOME" else (dr - cr)

        revenue_mtd = _sum_posted_lines("INCOME", month_start, today)
        expenses_mtd = _sum_posted_lines("EXPENSE", month_start, today)
        net_profit_mtd = revenue_mtd - expenses_mtd

        # Cash balance (lifetime)
        cash_lines = JournalEntryLine.objects.filter(
            account__code__in=["1110", "1120"],
            journal_entry__status=JournalEntry.Status.POSTED,
        )
        cash_dr = cash_lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
        cash_cr = cash_lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")
        cash_balance = cash_dr - cash_cr

        # Accounts receivable
        ar_lines = JournalEntryLine.objects.filter(
            account__code__in=["1130", "1140"],
            journal_entry__status=JournalEntry.Status.POSTED,
        )
        ar_dr = ar_lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
        ar_cr = ar_lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")

        # Accounts payable
        ap_lines = JournalEntryLine.objects.filter(
            account__code__in=["2110", "2120"],
            journal_entry__status=JournalEntry.Status.POSTED,
        )
        ap_dr = ap_lines.aggregate(t=Sum("debit"))["t"] or Decimal("0")
        ap_cr = ap_lines.aggregate(t=Sum("credit"))["t"] or Decimal("0")

        return Response({
            "month": str(month_start),
            "revenue_mtd": str(revenue_mtd),
            "expenses_mtd": str(expenses_mtd),
            "net_profit_mtd": str(net_profit_mtd),
            "cash_balance": str(cash_balance),
            "accounts_receivable": str(ar_dr - ar_cr),
            "accounts_payable": str(ap_cr - ap_dr),
        })
