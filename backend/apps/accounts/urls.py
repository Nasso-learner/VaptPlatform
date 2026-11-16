from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import AuthConfigView, ChangePasswordView, CurrentUserView, LoginView, LogoutView, RegisterView

urlpatterns = [
    path("config/", AuthConfigView.as_view(), name="auth-config"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("token/", LoginView.as_view(), name="auth-token"),
    path("token/refresh/", TokenRefreshView.as_view(), name="auth-token-refresh"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("password/", ChangePasswordView.as_view(), name="auth-password"),
    path("me/", CurrentUserView.as_view(), name="auth-me"),
]
