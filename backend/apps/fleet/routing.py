from django.urls import path
from . import consumers

websocket_urlpatterns = [
    path("ws/v1/fleet/live/", consumers.FleetLiveConsumer.as_asgi()),
]
