"""Payment gateway abstraction layer (Module 13 — Part XIII of spec)."""
from abc import ABC, abstractmethod
from typing import Optional
import requests
import logging

logger = logging.getLogger(__name__)


class PaymentGateway(ABC):
    @abstractmethod
    def initiate_payment(self, amount: float, reference: str, callback_url: str) -> dict:
        """Initiate a payment. Returns gateway-specific response dict."""
        ...

    @abstractmethod
    def verify_payment(self, reference: str) -> bool:
        """Verify payment status. Returns True if paid."""
        ...


class ESewaGateway(PaymentGateway):
    BASE_URL = "https://esewa.com.np/epay"

    def __init__(self, merchant_id: str):
        self.merchant_id = merchant_id

    def initiate_payment(self, amount: float, reference: str, callback_url: str) -> dict:
        return {
            "gateway": "esewa",
            "merchant_id": self.merchant_id,
            "amount": amount,
            "reference": reference,
            "redirect_url": f"{self.BASE_URL}/main",
            "callback_url": callback_url,
        }

    def verify_payment(self, reference: str) -> bool:
        try:
            response = requests.get(
                f"{self.BASE_URL}/transrec",
                params={"oid": reference, "scd": self.merchant_id},
                timeout=10,
            )
            return response.status_code == 200 and "Success" in response.text
        except Exception as e:
            logger.error(f"eSewa verify failed: {e}")
            return False


class KhaltiGateway(PaymentGateway):
    BASE_URL = "https://khalti.com/api/v2"

    def __init__(self, secret_key: str):
        self.secret_key = secret_key

    def initiate_payment(self, amount: float, reference: str, callback_url: str) -> dict:
        return {
            "gateway": "khalti",
            "amount": int(amount * 100),  # paisa
            "reference": reference,
            "redirect_url": callback_url,
        }

    def verify_payment(self, reference: str) -> bool:
        try:
            response = requests.post(
                f"{self.BASE_URL}/payment/verify/",
                json={"token": reference, "amount": 0},
                headers={"Authorization": f"Key {self.secret_key}"},
                timeout=10,
            )
            return response.status_code == 200
        except Exception as e:
            logger.error(f"Khalti verify failed: {e}")
            return False


class FonepayGateway(PaymentGateway):
    def __init__(self, merchant_id: str):
        self.merchant_id = merchant_id

    def initiate_payment(self, amount: float, reference: str, callback_url: str) -> dict:
        return {
            "gateway": "fonepay",
            "merchant_id": self.merchant_id,
            "amount": amount,
            "reference": reference,
        }

    def verify_payment(self, reference: str) -> bool:
        return False  # Implement with Fonepay actual API


class CashGateway(PaymentGateway):
    def initiate_payment(self, amount: float, reference: str, callback_url: str) -> dict:
        return {"gateway": "cash", "amount": amount, "reference": reference}

    def verify_payment(self, reference: str) -> bool:
        return True  # Cash is always verified at counter


def get_payment_gateway(method: str) -> PaymentGateway:
    from django.conf import settings
    gateways = {
        "ESEWA": lambda: ESewaGateway(settings.ESEWA_MERCHANT_ID),
        "KHALTI": lambda: KhaltiGateway(settings.KHALTI_SECRET_KEY),
        "FONEPAY": lambda: FonepayGateway(settings.FONEPAY_MERCHANT_ID),
        "CASH": lambda: CashGateway(),
        "CONNECT_IPS": lambda: CashGateway(),  # TODO: implement ConnectIPS
    }
    factory = gateways.get(method.upper())
    if not factory:
        raise ValueError(f"Unknown payment method: {method}")
    return factory()
