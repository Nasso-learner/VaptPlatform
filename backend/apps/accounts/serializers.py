from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "full_name", "is_staff", "is_active", "date_joined", "last_login")
        read_only_fields = ("id", "email", "is_staff", "is_active", "date_joined", "last_login")


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:
        model = User
        fields = ("email", "full_name", "password")

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value.lower()

    def validate(self, attrs):
        validate_password(attrs["password"], User(email=attrs["email"], full_name=attrs.get("full_name", "")))
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class AdminUserSerializer(serializers.ModelSerializer):
    """Platform administration of accounts. Password is write-only and optional on update."""
    password = serializers.CharField(write_only=True, required=False, style={"input_type": "password"})
    project_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = User
        fields = ("id", "email", "full_name", "is_staff", "is_active", "date_joined", "last_login", "project_count", "password")
        read_only_fields = ("id", "date_joined", "last_login", "project_count")

    def validate_email(self, value):
        value = value.lower()
        clash = User.objects.filter(email__iexact=value)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        if "password" in attrs:
            validate_password(attrs["password"], self.instance or User(email=attrs.get("email", ""), full_name=attrs.get("full_name", "")))
        elif self.instance is None:
            raise serializers.ValidationError({"password": "This field is required."})
        request = self.context.get("request")
        if self.instance and request and self.instance.pk == request.user.pk:
            if attrs.get("is_staff") is False or attrs.get("is_active") is False:
                raise serializers.ValidationError("You cannot remove your own admin rights or deactivate your own account.")
        return attrs

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)

    def update(self, user, validated_data):
        password = validated_data.pop("password", None)
        user = super().update(user, validated_data)
        if password:
            user.set_password(password)
            user.save(update_fields=["password"])
        return user


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, style={"input_type": "password"})
    new_password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        validate_password(value, self.context["request"].user)
        return value


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()
