/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API,
  downloadTextAsFile,
  renderQuota,
  renderQuotaWithPrompt,
  showError,
  showSuccess,
} from '../../../../helpers';
import { useIsMobile } from '../../../../hooks/common/useIsMobile';
import {
  Avatar,
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  SideSheet,
  Space,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconClose,
  IconCreditCard,
  IconGift,
  IconSave,
} from '@douyinfe/semi-icons';

const { Text, Title } = Typography;

const EditRedemptionModal = (props) => {
  const { t } = useTranslation();
  const isEdit = props.editingRedemption.id !== undefined;
  const isMobile = useIsMobile();
  const formApiRef = useRef(null);
  const [loading, setLoading] = useState(isEdit);
  const [plansLoading, setPlansLoading] = useState(false);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);

  const getInitValues = () => ({
    name: '',
    quota: 100000,
    count: 1,
    expired_time: null,
    subscription_plan_id: 0,
  });

  const getPlanOptions = () =>
    (subscriptionPlans || []).map((item) => {
      const plan = item?.plan || {};
      return {
        value: plan.id,
        label: plan.enabled ? plan.title : `${plan.title}（${t('已禁用')}）`,
      };
    });

  const getPlanTitle = (planId) => {
    const targetId = Number(planId || 0);
    if (!targetId) return '';
    const matched = (subscriptionPlans || []).find(
      (item) => Number(item?.plan?.id || 0) === targetId,
    );
    return matched?.plan?.title || '';
  };

  const trimRedemptionName = (value) =>
    Array.from(String(value || ''))
      .slice(0, 20)
      .join('');

  const getQuotaExtraText = (values) => {
    const quota = Number(values?.quota || 0);
    const planId = Number(values?.subscription_plan_id || 0);
    const extras = [];
    if (quota > 0) {
      extras.push(renderQuotaWithPrompt(quota));
    }
    if (planId > 0 && quota === 0) {
      extras.push(t('仅开通套餐，不赠送钱包额度'));
    }
    if (planId > 0 && quota > 0) {
      extras.push(t('兑换码将同时发放钱包额度与订阅权益'));
    }
    return extras.join(' · ');
  };

  const buildDefaultName = (values) => {
    const quota = parseInt(values?.quota, 10) || 0;
    const planTitle = getPlanTitle(values?.subscription_plan_id);
    if (planTitle && quota > 0) {
      return trimRedemptionName(`${planTitle} · ${renderQuota(quota)}`);
    }
    if (planTitle) {
      return trimRedemptionName(planTitle);
    }
    if (quota > 0) {
      return trimRedemptionName(renderQuota(quota));
    }
    return trimRedemptionName(t('订阅兑换码'));
  };

  const handleCancel = () => {
    props.handleClose();
  };

  const loadSubscriptionPlans = async () => {
    setPlansLoading(true);
    try {
      const res = await API.get('/api/subscription/admin/plans');
      if (res.data?.success) {
        setSubscriptionPlans(res.data.data || []);
      } else {
        setSubscriptionPlans([]);
        showError(res.data?.message || t('请求失败'));
      }
    } catch (error) {
      setSubscriptionPlans([]);
      showError(error.message || t('请求失败'));
    } finally {
      setPlansLoading(false);
    }
  };

  const loadRedemption = async () => {
    setLoading(true);
    try {
      const res = await API.get(`/api/redemption/${props.editingRedemption.id}`);
      const { success, message, data } = res.data;
      if (success) {
        const nextValues = {
          ...getInitValues(),
          ...data,
          subscription_plan_id: Number(data.subscription_plan_id || 0),
          expired_time:
            data.expired_time === 0 || !data.expired_time
              ? null
              : new Date(data.expired_time * 1000),
        };
        formApiRef.current?.setValues(nextValues);
      } else {
        showError(message);
      }
    } catch (error) {
      showError(error.message || t('请求失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!props.visiable) return;
    loadSubscriptionPlans();
  }, [props.visiable]);

  useEffect(() => {
    if (!props.visiable || !formApiRef.current) return;
    if (isEdit) {
      loadRedemption();
    } else {
      formApiRef.current.setValues(getInitValues());
      setLoading(false);
    }
  }, [props.visiable, props.editingRedemption.id, isEdit]);

  const submit = async (values) => {
    const localInputs = { ...values };
    localInputs.count = parseInt(localInputs.count, 10) || 0;
    localInputs.quota = parseInt(localInputs.quota, 10) || 0;
    localInputs.subscription_plan_id =
      parseInt(localInputs.subscription_plan_id, 10) || 0;
    localInputs.name =
      localInputs.name && localInputs.name.trim() !== ''
        ? trimRedemptionName(localInputs.name.trim())
        : buildDefaultName(localInputs);
    localInputs.expired_time = localInputs.expired_time
      ? Math.floor(localInputs.expired_time.getTime() / 1000)
      : 0;

    setLoading(true);
    try {
      let res;
      if (isEdit) {
        res = await API.put('/api/redemption/', {
          ...localInputs,
          id: parseInt(props.editingRedemption.id, 10),
        });
      } else {
        res = await API.post('/api/redemption/', localInputs);
      }

      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return;
      }

      if (isEdit) {
        showSuccess(t('兑换码更新成功！'));
        await props.refresh();
        props.handleClose();
        return;
      }

      showSuccess(t('兑换码创建成功！'));
      await props.refresh();
      formApiRef.current?.setValues(getInitValues());
      props.handleClose();

      if (data) {
        const text = data.join('\n');
        Modal.confirm({
          title: t('兑换码创建成功'),
          content: (
            <div>
              <p>{t('兑换码创建成功，是否下载兑换码？')}</p>
              <p>{t('兑换码将以文本文件的形式下载，文件名为兑换码的名称。')}</p>
            </div>
          ),
          onOk: () => {
            downloadTextAsFile(text, `${localInputs.name}.txt`);
          },
        });
      }
    } catch (error) {
      showError(error.message || t('请求失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SideSheet
      placement={isEdit ? 'right' : 'left'}
      title={
        <Space>
          {isEdit ? (
            <Tag color='blue' shape='circle'>
              {t('更新')}
            </Tag>
          ) : (
            <Tag color='green' shape='circle'>
              {t('新建')}
            </Tag>
          )}
          <Title heading={4} className='m-0'>
            {isEdit ? t('更新兑换码信息') : t('创建新的兑换码')}
          </Title>
        </Space>
      }
      bodyStyle={{ padding: '0' }}
      visible={props.visiable}
      width={isMobile ? '100%' : 600}
      footer={
        <div className='flex justify-end bg-white'>
          <Space>
            <Button
              theme='solid'
              onClick={() => formApiRef.current?.submitForm()}
              icon={<IconSave />}
              loading={loading}
            >
              {t('提交')}
            </Button>
            <Button
              theme='light'
              type='primary'
              onClick={handleCancel}
              icon={<IconClose />}
            >
              {t('取消')}
            </Button>
          </Space>
        </div>
      }
      closeIcon={null}
      onCancel={handleCancel}
    >
      <Spin spinning={loading || plansLoading}>
        <Form
          initValues={getInitValues()}
          getFormApi={(api) => (formApiRef.current = api)}
          onSubmit={submit}
        >
          {({ values }) => (
            <div className='p-2'>
              <Card className='!rounded-2xl shadow-sm border-0 mb-6'>
                <div className='flex items-center mb-2'>
                  <Avatar size='small' color='blue' className='mr-2 shadow-md'>
                    <IconGift size={16} />
                  </Avatar>
                  <div>
                    <Text className='text-lg font-medium'>
                      {t('基本信息')}
                    </Text>
                    <div className='text-xs text-gray-600'>
                      {t('设置兑换码的基本信息')}
                    </div>
                  </div>
                </div>

                <Row gutter={12}>
                  <Col span={24}>
                    <Form.Input
                      field='name'
                      label={t('名称')}
                      placeholder={t('请输入名称')}
                      style={{ width: '100%' }}
                      maxLength={20}
                      rules={
                        !isEdit
                          ? []
                          : [{ required: true, message: t('请输入名称') }]
                      }
                      showClear
                    />
                  </Col>

                  <Col span={24}>
                    <Form.Select
                      field='subscription_plan_id'
                      label={t('订阅套餐')}
                      placeholder={t('不关联套餐')}
                      optionList={[
                        { value: 0, label: t('不关联套餐') },
                        ...getPlanOptions(),
                      ]}
                      style={{ width: '100%' }}
                      extraText={t(
                        '兑换码可选绑定一个订阅套餐，用户兑换后将立即开通该套餐权益',
                      )}
                    />
                  </Col>

                  <Col span={24}>
                    <Form.DatePicker
                      field='expired_time'
                      label={t('过期时间')}
                      type='dateTime'
                      placeholder={t('选择过期时间（可选，留空为永久）')}
                      style={{ width: '100%' }}
                      showClear
                    />
                  </Col>
                </Row>
              </Card>

              <Card className='!rounded-2xl shadow-sm border-0'>
                <div className='flex items-center mb-2'>
                  <Avatar
                    size='small'
                    color='green'
                    className='mr-2 shadow-md'
                  >
                    <IconCreditCard size={16} />
                  </Avatar>
                  <div>
                    <Text className='text-lg font-medium'>
                      {t('额度设置')}
                    </Text>
                    <div className='text-xs text-gray-600'>
                      {t('设置兑换码的额度和数量')}
                    </div>
                  </div>
                </div>

                <Row gutter={12}>
                  <Col span={12}>
                    <Form.AutoComplete
                      field='quota'
                      label={t('额度')}
                      placeholder={t('请输入额度')}
                      style={{ width: '100%' }}
                      type='number'
                      rules={[
                        { required: true, message: t('请输入额度') },
                        {
                          validator: (_, value) => {
                            const quota = parseInt(value, 10) || 0;
                            const planId =
                              parseInt(values.subscription_plan_id, 10) || 0;
                            if (quota < 0) {
                              return Promise.reject(t('额度不能为负数'));
                            }
                            if (quota === 0 && planId <= 0) {
                              return Promise.reject(
                                t('额度为 0 时，必须至少关联一个订阅套餐'),
                              );
                            }
                            return Promise.resolve();
                          },
                        },
                      ]}
                      extraText={getQuotaExtraText(values)}
                      data={[
                        { value: 500000, label: '1$' },
                        { value: 5000000, label: '10$' },
                        { value: 25000000, label: '50$' },
                        { value: 50000000, label: '100$' },
                        { value: 250000000, label: '500$' },
                        { value: 500000000, label: '1000$' },
                      ]}
                      showClear
                    />
                  </Col>

                  {!isEdit && (
                    <Col span={12}>
                      <Form.InputNumber
                        field='count'
                        label={t('生成数量')}
                        min={1}
                        rules={[
                          { required: true, message: t('请输入生成数量') },
                          {
                            validator: (_, value) => {
                              const count = parseInt(value, 10);
                              return count > 0
                                ? Promise.resolve()
                                : Promise.reject(t('生成数量必须大于0'));
                            },
                          },
                        ]}
                        style={{ width: '100%' }}
                        showClear
                      />
                    </Col>
                  )}
                </Row>
              </Card>
            </div>
          )}
        </Form>
      </Spin>
    </SideSheet>
  );
};

export default EditRedemptionModal;
