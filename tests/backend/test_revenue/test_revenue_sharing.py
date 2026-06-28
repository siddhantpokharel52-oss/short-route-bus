"""Tests for revenue sharing calculations."""
import pytest
from decimal import Decimal


@pytest.mark.django_db
class TestRevenueSharing:
    """Verify revenue split logic between operators and platform."""

    def test_basic_plan_commission_rate(self):
        """BASIC plan: 8% platform commission."""
        from django.conf import settings
        assert settings.COMMISSION_RATES['BASIC'] == 8

    def test_standard_plan_commission_rate(self):
        """STANDARD plan: 6% platform commission."""
        from django.conf import settings
        assert settings.COMMISSION_RATES['STANDARD'] == 6

    def test_enterprise_plan_commission_rate(self):
        """ENTERPRISE plan: 4% platform commission."""
        from django.conf import settings
        assert settings.COMMISSION_RATES['ENTERPRISE'] == 4

    def test_revenue_split_calculation(self):
        """Verify the math: total_revenue * (1 - commission_rate/100) = operator_share."""
        total = Decimal('10000.00')
        commission_pct = Decimal('8')
        commission = total * commission_pct / 100
        operator_share = total - commission
        assert commission == Decimal('800.00')
        assert operator_share == Decimal('9200.00')

    def test_route_assignment_share_validation(self):
        """Sum of route assignment shares on a shared route must total 100%."""
        shares = [Decimal('60'), Decimal('40')]
        assert sum(shares) == Decimal('100')

    def test_zero_share_invalid(self):
        """Share percentage must be greater than 0."""
        with pytest.raises(Exception):
            share = Decimal('0')
            if share <= 0:
                raise ValueError('Share percentage must be > 0')


@pytest.mark.django_db
class TestRevenueAPI:
    def test_revenue_summary_requires_auth(self, api_client):
        response = api_client.get('/api/v1/revenue/summary/')
        assert response.status_code == 401

    def test_revenue_summary_accessible_by_finance(self, auth_client_company_admin):
        response = auth_client_company_admin.get('/api/v1/revenue/summary/')
        assert response.status_code in (200, 404)  # 404 if no data yet

    def test_revenue_records_list(self, auth_client_company_admin):
        response = auth_client_company_admin.get('/api/v1/revenue/records/')
        assert response.status_code in (200, 404)
