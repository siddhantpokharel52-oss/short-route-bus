from rest_framework.views import exception_handler
from rest_framework.response import Response
from django.utils import timezone


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is not None:
        response.data = {
            "success": False,
            "data": None,
            "message": "An error occurred.",
            "errors": response.data,
            "meta": {"timestamp": timezone.now().isoformat()},
        }

        if response.status_code == 401:
            response.data["message"] = "Authentication required."
        elif response.status_code == 403:
            response.data["message"] = "Permission denied."
        elif response.status_code == 404:
            response.data["message"] = "Resource not found."
        elif response.status_code == 400:
            response.data["message"] = "Validation failed."

    return response
