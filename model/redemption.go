package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"gorm.io/gorm"
)

var (
	// ErrRedeemFailed is returned when redemption fails due to unexpected database errors.
	ErrRedeemFailed = errors.New("redeem.failed")

	ErrRedemptionNotProvided = errors.New("未提供兑换码")
	ErrRedemptionInvalid     = errors.New("无效的兑换码")
	ErrRedemptionUsed        = errors.New("该兑换码已被使用")
	ErrRedemptionExpired     = errors.New("该兑换码已过期")
	ErrRedemptionPlanMissing = errors.New("关联的订阅套餐不存在")
)

type Redemption struct {
	Id                    int            `json:"id"`
	UserId                int            `json:"user_id"`
	Key                   string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status                int            `json:"status" gorm:"default:1"`
	Name                  string         `json:"name" gorm:"index"`
	Quota                 int            `json:"quota" gorm:"default:100"`
	SubscriptionPlanId    int            `json:"subscription_plan_id" gorm:"index;default:0"`
	SubscriptionPlanTitle string         `json:"subscription_plan_title,omitempty" gorm:"-:all"`
	CreatedTime           int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime          int64          `json:"redeemed_time" gorm:"bigint"`
	Count                 int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId            int            `json:"used_user_id"`
	DeletedAt             gorm.DeletedAt `gorm:"index"`
	ExpiredTime           int64          `json:"expired_time" gorm:"bigint"` // 0 means never expires
}

type RedeemResult struct {
	Quota                 int    `json:"quota"`
	SubscriptionPlanId    int    `json:"subscription_plan_id,omitempty"`
	SubscriptionPlanTitle string `json:"subscription_plan_title,omitempty"`
	UserSubscriptionId    int    `json:"user_subscription_id,omitempty"`
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err = tx.Model(&Redemption{}).Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func SearchRedemptions(keyword string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&Redemption{})
	if id, convErr := strconv.Atoi(keyword); convErr == nil {
		query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
	} else {
		query = query.Where("name LIKE ?", keyword+"%")
	}

	if err = query.Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空")
	}
	redemption := Redemption{Id: id}
	if err := DB.First(&redemption, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &redemption, nil
}

func LoadRedemptionPlanTitles(redemptions []*Redemption) error {
	if len(redemptions) == 0 {
		return nil
	}
	planIds := make([]int, 0, len(redemptions))
	seen := make(map[int]struct{}, len(redemptions))
	for _, redemption := range redemptions {
		if redemption == nil || redemption.SubscriptionPlanId <= 0 {
			continue
		}
		if _, ok := seen[redemption.SubscriptionPlanId]; ok {
			continue
		}
		seen[redemption.SubscriptionPlanId] = struct{}{}
		planIds = append(planIds, redemption.SubscriptionPlanId)
	}
	if len(planIds) == 0 {
		return nil
	}
	var plans []SubscriptionPlan
	if err := DB.Select("id", "title").Where("id IN ?", planIds).Find(&plans).Error; err != nil {
		return err
	}
	titleMap := make(map[int]string, len(plans))
	for _, plan := range plans {
		titleMap[plan.Id] = plan.Title
	}
	for _, redemption := range redemptions {
		if redemption == nil || redemption.SubscriptionPlanId <= 0 {
			continue
		}
		redemption.SubscriptionPlanTitle = titleMap[redemption.SubscriptionPlanId]
	}
	return nil
}

func LoadSingleRedemptionPlanTitle(redemption *Redemption) error {
	if redemption == nil || redemption.SubscriptionPlanId <= 0 {
		return nil
	}
	return LoadRedemptionPlanTitles([]*Redemption{redemption})
}

func Redeem(key string, userId int) (*RedeemResult, error) {
	if key == "" {
		return nil, ErrRedemptionNotProvided
	}
	if userId == 0 {
		return nil, errors.New("无效的 user id")
	}

	redemption := &Redemption{}
	result := &RedeemResult{}
	upgradeGroup := ""

	keyCol := "`key`"
	if common.UsingPostgreSQL {
		keyCol = `"key"`
	}

	common.RandomSleep()
	err := DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Set("gorm:query_option", "FOR UPDATE").Where(keyCol+" = ?", key).First(redemption).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrRedemptionInvalid
			}
			return err
		}
		if redemption.Status != common.RedemptionCodeStatusEnabled {
			return ErrRedemptionUsed
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return ErrRedemptionExpired
		}
		if redemption.Quota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota + ?", redemption.Quota)).Error; err != nil {
				return err
			}
		}
		if redemption.SubscriptionPlanId > 0 {
			plan, err := getSubscriptionPlanByIdTx(tx, redemption.SubscriptionPlanId)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrRedemptionPlanMissing
				}
				return err
			}
			sub, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, "redemption")
			if err != nil {
				return err
			}
			result.SubscriptionPlanId = plan.Id
			result.SubscriptionPlanTitle = plan.Title
			result.UserSubscriptionId = sub.Id
			upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
		}
		redemption.RedeemedTime = common.GetTimestamp()
		redemption.Status = common.RedemptionCodeStatusUsed
		redemption.UsedUserId = userId
		if err := tx.Save(redemption).Error; err != nil {
			return err
		}
		result.Quota = redemption.Quota
		return nil
	})
	if err != nil {
		common.SysError("redemption failed: " + err.Error())
		if errors.Is(err, ErrRedemptionNotProvided) ||
			errors.Is(err, ErrRedemptionInvalid) ||
			errors.Is(err, ErrRedemptionUsed) ||
			errors.Is(err, ErrRedemptionExpired) ||
			errors.Is(err, ErrRedemptionPlanMissing) {
			return nil, err
		}
		if strings.Contains(err.Error(), "购买上限") {
			return nil, err
		}
		return nil, ErrRedeemFailed
	}

	if upgradeGroup != "" {
		_ = UpdateUserGroupCache(userId, upgradeGroup)
	}

	logParts := make([]string, 0, 2)
	if redemption.Quota > 0 {
		logParts = append(logParts, fmt.Sprintf("充值 %s", logger.LogQuota(redemption.Quota)))
	}
	if result.SubscriptionPlanTitle != "" {
		logParts = append(logParts, fmt.Sprintf("开通订阅套餐 %s", result.SubscriptionPlanTitle))
	}
	logDetail := strings.Join(logParts, "，")
	if logDetail == "" {
		logDetail = "兑换成功"
	}
	RecordLog(userId, LogTypeTopup, fmt.Sprintf("通过兑换码%s，兑换码ID %d", logDetail, redemption.Id))
	return result, nil
}

func (redemption *Redemption) Insert() error {
	return DB.Create(redemption).Error
}

func (redemption *Redemption) SelectUpdate() error {
	return DB.Model(redemption).Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
func (redemption *Redemption) Update() error {
	return DB.Model(redemption).
		Select("name", "status", "quota", "subscription_plan_id", "redeemed_time", "expired_time").
		Updates(redemption).Error
}

func (redemption *Redemption) Delete() error {
	return DB.Delete(redemption).Error
}

func DeleteRedemptionById(id int) error {
	if id == 0 {
		return errors.New("id 为空")
	}
	redemption := Redemption{Id: id}
	if err := DB.Where(redemption).First(&redemption).Error; err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where(
		"status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)",
		[]int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled},
		common.RedemptionCodeStatusEnabled,
		now,
	).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
