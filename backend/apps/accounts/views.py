from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count
from rest_framework import generics, permissions, status, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.audit.services import record

from .serializers import AdminUserSerializer, ChangePasswordSerializer, LogoutSerializer, RegisterSerializer, UserSerializer

User = get_user_model()


class AuthConfigView(APIView):
    """Public: lets the login screen know whether to offer 'create account'."""
    permission_classes = (permissions.AllowAny,)
    authentication_classes = ()

    def get(self, request):
        return Response({"registration_open": settings.ALLOW_PUBLIC_REGISTRATION})


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = (permissions.AllowAny,)

    def create(self, request, *args, **kwargs):
        if not settings.ALLOW_PUBLIC_REGISTRATION:
            raise PermissionDenied("Self-registration is disabled. Ask an administrator to create your account.")
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        user = serializer.save()
        record(actor=user, action="user.register", request=self.request, target=user, target_label=user.email)


class LoginView(TokenObtainPairView):
    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            user = User.objects.filter(email__iexact=str(request.data.get("email", ""))).first()
            if user:
                record(actor=user, action="auth.login", request=request, target=user, target_label=user.email)
        return response


class LogoutView(APIView):
    """Blacklists the refresh token so a stolen copy can no longer mint access tokens."""

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError:
            pass  # already expired or blacklisted: the goal (token unusable) is met
        record(actor=request.user, action="auth.logout", request=request, target=request.user, target_label=request.user.email)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        record(actor=request.user, action="user.password_change", request=request, target=request.user, target_label=request.user.email)
        return Response({"detail": "Password updated."})


class CurrentUserView(generics.RetrieveUpdateAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user

    def perform_update(self, serializer):
        serializer.save()
        record(actor=self.request.user, action="user.profile_update", request=self.request, target=self.request.user,
               target_label=self.request.user.email)


class UserViewSet(viewsets.ModelViewSet):
    """Platform user administration (admins only). Accounts are deactivated, never deleted, so history stays attributable."""
    serializer_class = AdminUserSerializer
    permission_classes = (permissions.IsAdminUser,)
    http_method_names = ("get", "post", "patch", "head", "options")
    filterset_fields = ("is_staff", "is_active")
    search_fields = ("email", "full_name")
    ordering_fields = ("email", "date_joined", "last_login", "project_count")

    def get_queryset(self):
        return User.objects.annotate(project_count=Count("project_memberships", distinct=True)).order_by("email")

    def perform_create(self, serializer):
        user = serializer.save()
        record(actor=self.request.user, action="user.create", request=self.request, target=user, target_label=user.email,
               is_staff=user.is_staff)

    def perform_update(self, serializer):
        user = serializer.save()
        record(actor=self.request.user, action="user.update", request=self.request, target=user, target_label=user.email,
               changed=sorted(k for k in serializer.validated_data if k != "password"), password_reset="password" in serializer.validated_data)
