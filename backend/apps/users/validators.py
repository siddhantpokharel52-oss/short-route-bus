"""Shared email/password validation used by every place in the codebase that
sets a login (registration, change-password, and the various create-login/
create-admin actions in apps.staff, apps.fleet, apps.tenants). Those actions
read straight from request.data and call set_password()/User(...) directly,
bypassing DRF serializer fields and Django's own validate_password() -- these
two helpers give them the same checks without duplicating the regex/rules in
every view.
"""
import re

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email as django_validate_email
from django.contrib.auth.password_validation import validate_password


class ComplexityPasswordValidator:
    """Registered in AUTH_PASSWORD_VALIDATORS so validate_password() enforces
    it everywhere that function is already called (UserCreateSerializer,
    ChangePasswordSerializer) -- on top of the existing length/common-password/
    similarity checks, not replacing them."""

    def validate(self, password, user=None):
        problems = []
        if not re.search(r"[A-Z]", password):
            problems.append("an uppercase letter")
        if not re.search(r"[a-z]", password):
            problems.append("a lowercase letter")
        if not re.search(r"[0-9]", password):
            problems.append("a number")
        if not re.search(r"[^A-Za-z0-9]", password):
            problems.append("a special character")
        if problems:
            raise DjangoValidationError(
                "Password must include " + ", ".join(problems) + ".",
                code="password_missing_complexity",
            )

    def get_help_text(self):
        return "Your password must include an uppercase letter, a lowercase letter, a number, and a special character."


def validate_password_or_messages(password):
    """Runs the full AUTH_PASSWORD_VALIDATORS chain (length, complexity, common-
    password, etc). Returns a list of error message strings -- empty if valid."""
    try:
        validate_password(password)
    except DjangoValidationError as e:
        return list(e.messages)
    return []


def validate_email_or_message(email):
    """Returns an error message string, or None if the email is well-formed."""
    try:
        django_validate_email(email)
    except DjangoValidationError:
        return "Enter a valid email address."
    return None
