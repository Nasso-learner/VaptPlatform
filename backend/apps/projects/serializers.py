from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.accounts.serializers import UserSerializer

from .models import Project, ProjectMembership, ProjectRole

User = get_user_model()


class ProjectSerializer(serializers.ModelSerializer):
    repository_token = serializers.CharField(write_only=True, required=False, allow_blank=True, style={"input_type": "password"})
    authorization_confirmed = serializers.BooleanField(write_only=True, required=False,
                                                       help_text="Must be true on create: you own the targets or have written permission to test them.")
    my_role = serializers.CharField(read_only=True)
    has_repository_token = serializers.SerializerMethodField()
    is_repository_verified = serializers.BooleanField(read_only=True)
    is_target_verified = serializers.BooleanField(read_only=True)
    created_by = UserSerializer(read_only=True)

    class Meta:
        model = Project
        fields = (
            "id", "name", "slug", "description", "created_by", "created_at", "updated_at", "is_archived", "my_role",
            "repository_url", "repository_branch", "repository_token", "has_repository_token", "repository_access_level",
            "is_repository_verified", "repository_verified_at", "repository_head_commit",
            "target_url", "is_target_verified", "target_verified_at",
            "allow_sast", "allow_dast", "allow_active_dast", "authorization_confirmed", "authorization_confirmed_at",
            "latest_risk_score", "latest_risk_grade", "open_findings_count", "last_scanned_at",
        )
        read_only_fields = (
            "slug", "repository_access_level", "repository_verified_at", "repository_head_commit", "target_verified_at",
            "authorization_confirmed_at", "latest_risk_score", "latest_risk_grade", "open_findings_count", "last_scanned_at",
        )

    def get_has_repository_token(self, project) -> bool:
        return bool(project.repository_token_encrypted)

    def validate_repository_url(self, value):
        if value and not value.startswith("https://"):
            raise serializers.ValidationError("Repository URL must use https://")
        return value.rstrip("/")

    def validate(self, attrs):
        if self.instance is None and not attrs.get("authorization_confirmed"):
            raise serializers.ValidationError({"authorization_confirmed": "Confirm you own or are authorized to test this project's targets."})
        merged = {**({f: getattr(self.instance, f) for f in ("repository_url", "target_url", "allow_sast", "allow_dast", "allow_active_dast")} if self.instance else {}), **attrs}
        if merged.get("allow_sast") and not merged.get("repository_url"):
            raise serializers.ValidationError({"repository_url": "Required when SAST is allowed."})
        if merged.get("allow_dast") and not merged.get("target_url"):
            raise serializers.ValidationError({"target_url": "Required when DAST is allowed."})
        if merged.get("allow_active_dast") and not merged.get("allow_dast"):
            raise serializers.ValidationError({"allow_active_dast": "Active DAST requires DAST to be allowed."})
        attrs.pop("authorization_confirmed", None)
        return attrs

    def update(self, project, validated_data):
        token = validated_data.pop("repository_token", None)
        if token is not None:
            project.repository_token = token or None
        # Changing a target invalidates its previous verification.
        if "repository_url" in validated_data and validated_data["repository_url"] != project.repository_url:
            project.repository_verified_at = None
            project.repository_access_level = "unverified"
        if "repository_branch" in validated_data and validated_data["repository_branch"] != project.repository_branch:
            project.repository_verified_at = None
        if "target_url" in validated_data and validated_data["target_url"] != project.target_url:
            project.target_verified_at = None
        return super().update(project, validated_data)


class ProjectMembershipSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    email = serializers.EmailField(write_only=True)

    class Meta:
        model = ProjectMembership
        fields = ("id", "user", "email", "role", "created_at")

    def validate_email(self, value):
        try:
            return User.objects.get(email__iexact=value)
        except User.DoesNotExist:
            raise serializers.ValidationError("No registered user with this email.")

    def validate_role(self, value):
        if value not in ProjectRole.values:
            raise serializers.ValidationError("invalid role")
        return value


class MembershipRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectMembership
        fields = ("id", "role")
