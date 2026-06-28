import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.development")

django_asgi_app = get_asgi_application()

from backend.apps.scheduling.routing import websocket_urlpatterns as scheduling_ws
from backend.apps.fleet.routing import websocket_urlpatterns as fleet_ws

websocket_urlpatterns = scheduling_ws + fleet_ws

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AuthMiddlewareStack(
            URLRouter(websocket_urlpatterns)
        ),
    }
)
