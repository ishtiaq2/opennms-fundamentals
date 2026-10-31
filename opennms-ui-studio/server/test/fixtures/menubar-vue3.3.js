import { defineComponent as _defineComponent } from "vue";
import { unref as _unref, createVNode as _createVNode, toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, resolveComponent as _resolveComponent, normalizeClass as _normalizeClass, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode, renderList as _renderList, createBlock as _createBlock, createTextVNode as _createTextVNode, toHandlers as _toHandlers, mergeProps as _mergeProps, withCtx as _withCtx, withKeys as _withKeys, pushScopeId as _pushScopeId, popScopeId as _popScopeId } from "vue";
const _withScopeId = (n) => (_pushScopeId("data-v-menubar"), n = n(), _popScopeId(), n);
const _hoisted_1 = { class: "center-flex" };
const _hoisted_2 = { class: "body-large left-margin-small formatted-time" };
const _hoisted_3 = ["href"];
const _hoisted_4 = { class: "menubar-dropdown-item-content menubar-padding" };
const _hoisted_5 = ["href"];
const _hoisted_6 = { class: "menubar-dropdown-item-content menubar-padding" };
const _hoisted_7 = ["href"];
const _hoisted_8 = { class: "left-margin-small" };
const _hoisted_9 = { class: "menubar-dropdown-item-content menubar-padding" };
const _hoisted_10 = ["href"];
const _hoisted_11 = ["action"];
const _hoisted_12 = { class: "menubar-dropdown-item-content menubar-padding" };
const _hoisted_13 = ["href"];
const _hoisted_14 = { class: "menubar-dropdown-item-content" };
const _hoisted_15 = ["href"];
const _hoisted_16 = { class: "left-margin-small" };
const _hoisted_17 = { class: "menubar-dropdown-item-content" };
const _hoisted_18 = { class: "notification-dropdown-item-content dropdown-menu-wrapper" };
const _hoisted_19 = ["onClick"];
const _hoisted_20 = { class: "full-width-left" };
const _hoisted_21 = { class: "font-weight-bold" };
const _hoisted_22 = { class: "dropdown-info-bar" };
const _hoisted_23 = { class: "menubar-dropdown-item-content" };
const _hoisted_24 = { class: "dropdown-menu-wrapper show-more-link notification-dropdown-item-content" };
const _hoisted_25 = ["href"];
const _hoisted_26 = { class: "menubar-dropdown-item-content" };
const _hoisted_27 = ["href"];
const _hoisted_28 = { class: "left-margin-small" };
const _hoisted_29 = ["href"];
const _hoisted_30 = ["href"];
const _hoisted_31 = ["href"];
import { FeatherAppBar, FeatherAppBarLink } from "@featherds/app-bar";
import { FeatherButton } from "@featherds/button";
import { FeatherDropdown, FeatherDropdownItem } from "@featherds/dropdown";
import { FeatherIcon } from "@featherds/icon";
import AddCircleAlt from "@featherds/icon/action/AddCircleAlt";
import ArrowDropDown from "@featherds/icon/navigation/ArrowDropDown";
import UpdateUtilities from "@featherds/icon/action/UpdateUtilities";
import Person from "@featherds/icon/action/Person";
import Logo from "@/assets/LogoHorizon.vue";
import { useAppStore } from "@/stores/appStore";
import { useMenuStore } from "@/stores/menuStore";
import { usePluginStore } from "@/stores/pluginStore";
import Search from "./Search.vue";
import { useOutsideClick } from "@featherds/composables/events/OutsideClick";
const light = "open-light";
const dark = "open-dark";
const maxNotifications = 2;
const HelpIndex = 0;
const SelfServiceIndex = 1;
const UserIndex = 2;
const PluginIndex = 3;
var stdin_default = /* @__PURE__ */ _defineComponent({
  __name: "Menubar",
  setup(__props) {
    const appStore = useAppStore();
    const menuStore = useMenuStore();
    const pluginStore = usePluginStore();
    const theme = ref("");
    const lastShift = reactive({ lastKey: "", timeSinceLastKey: 0 });
    const logoutForm = ref();
    const outsideClick = ref();
    useOutsideClick(outsideClick.value, () => {
      resetMenuItems();
    });
    const plugins = computed(() => pluginStore.plugins);
    const mainMenu = computed(() => menuStore.mainMenu);
    const menuItems = computed(() => {
      if (mainMenu.value && mainMenu.value.menus) {
        return mainMenu.value.menus?.filter((m) => m.name !== "Search");
      } else {
        return [];
      }
    });
    const menuItemsHovered = ref([]);
    const hoveredItems = ref([]);
    const resetMenuItems = () => {
      for (let i = 0; i < menuItemsHovered.value.length; i++) {
        menuItemsHovered.value[i] = false;
      }
      for (let i = 0; i < hoveredItems.value.length; i++) {
        hoveredItems.value[i] = false;
      }
    };
    const onHoverMenuItem = (key) => {
      resetMenuItems();
      menuItemsHovered.value[key] = true;
    };
    const hoverItem = (key) => {
      resetMenuItems();
      hoveredItems.value[key] = true;
    };
    const notificationSummary = computed(() => menuStore.notificationSummary);
    const noticesDisplay = computed(() => {
      const status = mainMenu.value?.noticeStatus;
      if (status === "On") {
        return {
          icon: "fa-solid fa-bell",
          colorClass: "alarm-ok",
          title: "Notices: On"
        };
      } else if (status === "Off") {
        return {
          icon: "fa-solid fa-bell-slash",
          colorClass: "alarm-error",
          title: "Notices: Off"
        };
      }
      return {
        icon: "fa-solid fa-bell",
        colorClass: "",
        title: ""
      };
    });
    const userNotificationBadgeClass = computed(() => {
      if (notificationSummary.value.userUnacknowledgedCount === 0) {
        return "badge-severity-cleared";
      }
      if (!notificationSummary.value.userUnacknowledgedNotifications || !notificationSummary.value.userUnacknowledgedNotifications.notification) {
        return "badge-severity-indeterminate";
      }
      const severities = ["cleared", "indeterminate", "warning", "minor", "major", "critical"];
      const severityIndexList = notificationSummary.value.userUnacknowledgedNotifications.notification.map((n) => severities.indexOf(n.severity.toLowerCase())) || [];
      const maxSeverityIndex = Math.max.apply(Math, severityIndexList);
      const maxSeverity = severities[maxSeverityIndex];
      return `badge-severity-${maxSeverity}`;
    });
    const teamNotificationBadgeClass = computed(
      () => notificationSummary.value.teamUnacknowledgedCount === 0 ? "badge-severity-cleared" : "badge-info"
    );
    const notificationsShowMoreLink = computed(
      () => mainMenu.value.userNotificationMenu?.items?.filter((item) => item.id === "user")[0].url || ""
    );
    const toggleDarkLightMode = (savedTheme) => {
      const el = document.body;
      const newTheme = theme.value === light ? dark : light;
      if (savedTheme && (savedTheme === light || savedTheme === dark)) {
        theme.value = savedTheme;
        el.classList.add(savedTheme);
        return;
      }
      el.classList.add(newTheme);
      if (theme.value) {
        el.classList.remove(theme.value);
      }
      theme.value = newTheme;
      localStorage.setItem("theme", theme.value);
      appStore.setTheme(theme.value);
    };
    const computeLink = (url, isVueLink) => {
      const baseLink = (isVueLink ? import.meta.env.VITE_VUE_BASE_URL : mainMenu.value?.baseHref || import.meta.env.VITE_BASE_URL) || "";
      return `${baseLink}${url}`;
    };
    const computePluginRelLink = (plugin) => {
      return `ui/#/plugins/${plugin.extensionId}/${plugin.resourceRootPath}/${plugin.moduleFileName}`;
    };
    const computeLogoutFormLink = () => {
      const logoutMenu = mainMenu.value.selfServiceMenu?.items?.find((x) => x.id === "logout");
      const baseLink = logoutMenu?.url || "j_spring_security_logout";
      return computeLink(baseLink, false);
    };
    const computeSelfServiceMenuLink = (item) => {
      if (item.id === "logout") {
        return "javascript:document.vueLogoutForm.submit()";
      }
      return computeLink(item.url || "", item.isVueLink);
    };
    const computeSearchLink = () => {
      if (mainMenu.value.menus) {
        const searchMenus = mainMenu.value?.menus.filter((m) => m.name === "Search");
        if (searchMenus && searchMenus.length > 0) {
          return computeLink(searchMenus[0].url || "");
        }
      }
      return "";
    };
    const onMenuItemClick = (url, isVueLink) => {
      const link = computeLink(url, isVueLink);
      window.location.assign(link);
    };
    const onSelfServiceMenuItemClick = (item) => {
      if (item.id === "logout") {
        logoutForm.value.submit();
        return;
      }
      onMenuItemClick(item.url || "", item.isVueLink);
    };
    const onNotificationItemClick = (item) => {
      const url = `notification/detail.jsp?notice=${item.id}`;
      onMenuItemClick(url);
    };
    const clearShiftCheck = () => {
      lastShift.lastKey = "";
      lastShift.timeSinceLastKey = 0;
    };
    const shiftCheck = (e) => {
      const shiftCodes = ["ShiftLeft", "ShiftRight"];
      const shiftDelay = 2e3;
      if (shiftCodes.includes(e.code)) {
        if (shiftCodes.includes(lastShift.lastKey)) {
          if (Date.now() - lastShift.timeSinceLastKey < shiftDelay) {
            clearShiftCheck();
            const elem = document.querySelector(".menubar-search textarea");
            if (elem) {
              elem.focus();
            }
          } else {
            clearShiftCheck();
          }
        } else {
          lastShift.lastKey = e.code;
          lastShift.timeSinceLastKey = Date.now();
        }
      } else {
        clearShiftCheck();
      }
    };
    onMounted(async () => {
      const savedTheme = localStorage.getItem("theme");
      toggleDarkLightMode(savedTheme);
      window.addEventListener("keyup", shiftCheck);
    });
    return (_ctx, _cache) => {
      const _component_font_awesome_icon = _resolveComponent("font-awesome-icon");
      return _openBlock(), _createBlock(_unref(FeatherAppBar), {
        labels: { skip: "main" },
        content: "app",
        ref: _unref(outsideClick),
        onMouseleave: resetMenuItems
      }, {
        left: _withCtx(() => [
          _createElementVNode("div", _hoisted_1, [
            _createVNode(_unref(FeatherAppBarLink), {
              icon: Logo,
              title: "Home",
              class: "logo-link home",
              type: "home",
              url: _unref(mainMenu).homeUrl || "/"
            }, null, 8, ["url"]),
            _unref(mainMenu).username ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
              _createElementVNode("span", _hoisted_2, _toDisplayString(_unref(mainMenu).formattedTime), 1),
              _createVNode(_component_font_awesome_icon, {
                icon: _unref(noticesDisplay).icon,
                class: _normalizeClass(`${_unref(noticesDisplay).colorClass} left-margin-small bell-icon`),
                title: _unref(noticesDisplay).title
              }, null, 8, ["icon", "class", "title"])
            ], 64)) : _createCommentVNode("", true),
            _createVNode(Search, { class: "search-left-margin" })
          ])
        ]),
        right: _withCtx(() => [
          _createElementVNode("a", {
            href: computeSearchLink(),
            class: "top-menu-link top-menu-search"
          }, "Search", 8, _hoisted_3),
          _unref(mainMenu).username ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
            (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(menuItems), (menuItem, index) => {
              return _openBlock(), _createBlock(_unref(FeatherDropdown), {
                tabIndex: 0,
                onKeyup: _withKeys(() => onHoverMenuItem(index), ["enter"]),
                onMouseenter: () => onHoverMenuItem(index),
                modelValue: _unref(menuItemsHovered)[index],
                right: "",
                key: menuItem.name || "",
                class: "menubar-dropdown"
              }, {
                trigger: _withCtx(({ attrs, on }) => [
                  _createVNode(_unref(FeatherButton), _mergeProps({
                    link: "",
                    href: "#"
                  }, attrs, _toHandlers(on), { class: "menubar-dropdown-button-dark" }), {
                    default: _withCtx(() => [
                      menuItem.icon && menuItem.iconType === "feather" && menuItem.icon === "Person" ? (_openBlock(), _createBlock(_unref(FeatherIcon), {
                        key: 0,
                        icon: _unref(Person)
                      }, null, 8, ["icon"])) : _createCommentVNode("", true),
                      menuItem.icon && menuItem.iconType === "fa" ? (_openBlock(), _createBlock(_component_font_awesome_icon, {
                        key: 1,
                        icon: `fa-solid ${menuItem.icon}`
                      }, null, 8, ["icon"])) : _createCommentVNode("", true),
                      _createTextVNode(" " + _toDisplayString(menuItem.name) + " ", 1),
                      _createVNode(_unref(FeatherIcon), { icon: _unref(ArrowDropDown) }, null, 8, ["icon"])
                    ]),
                    _: 2
                  }, 1040)
                ]),
                default: _withCtx(() => [
                  (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(menuItem.items, (item) => {
                    return _openBlock(), _createBlock(_unref(FeatherDropdownItem), {
                      key: item.name || "",
                      onClick: ($event) => onMenuItemClick(item.url || "", item.isVueLink)
                    }, {
                      default: _withCtx(() => [
                        _createElementVNode("div", _hoisted_4, [
                          _createElementVNode("a", {
                            href: computeLink(item.url || "", item.isVueLink),
                            class: "dropdown-menu-link"
                          }, [
                            item.icon && item.iconType === "fa" ? (_openBlock(), _createBlock(_component_font_awesome_icon, {
                              key: 0,
                              icon: `fa-solid ${item.icon}`
                            }, null, 8, ["icon"])) : _createCommentVNode("", true),
                            _createTextVNode(" " + _toDisplayString(item.name), 1)
                          ], 8, _hoisted_5)
                        ])
                      ]),
                      _: 2
                    }, 1032, ["onClick"]);
                  }), 128))
                ]),
                _: 2
              }, 1032, ["onKeyup", "onMouseenter", "modelValue"]);
            }), 128)),
            _unref(plugins) && _unref(plugins).length ? (_openBlock(), _createBlock(_unref(FeatherDropdown), {
              key: 0,
              class: "menubar-dropdown-dark",
              onMouseenter: _cache[0] || (_cache[0] = ($event) => hoverItem(PluginIndex)),
              modelValue: _unref(hoveredItems)[PluginIndex]
            }, {
              trigger: _withCtx(({ attrs, on }) => [
                _createVNode(_unref(FeatherButton), _mergeProps({
                  link: "",
                  href: "#"
                }, attrs, _toHandlers(on), { class: "menubar-dropdown-button-dark" }), {
                  default: _withCtx(() => [
                    _createTextVNode(" Plugins "),
                    _createVNode(_unref(FeatherIcon), { icon: _unref(ArrowDropDown) }, null, 8, ["icon"])
                  ]),
                  _: 2
                }, 1040)
              ]),
              default: _withCtx(() => [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(plugins), (plugin) => {
                  return _openBlock(), _createBlock(_unref(FeatherDropdownItem), {
                    key: plugin.extensionId,
                    onClick: ($event) => onMenuItemClick(computePluginRelLink(plugin))
                  }, {
                    default: _withCtx(() => [
                      _createElementVNode("div", _hoisted_6, [
                        _createElementVNode("a", {
                          href: computeLink(computePluginRelLink(plugin)),
                          class: "dropdown-menu-link"
                        }, [
                          _createVNode(_unref(FeatherIcon), { icon: _unref(UpdateUtilities) }, null, 8, ["icon"]),
                          _createElementVNode("span", _hoisted_8, _toDisplayString(plugin.menuEntry), 1)
                        ], 8, _hoisted_7)
                      ])
                    ]),
                    _: 2
                  }, 1032, ["onClick"]);
                }), 128))
              ]),
              _: 1
            }, 8, ["modelValue"])) : _createCommentVNode("", true),
            _unref(mainMenu).helpMenu ? (_openBlock(), _createBlock(_unref(FeatherDropdown), {
              key: 1,
              class: "menubar-dropdown-dark help-menu",
              onMouseenter: _cache[1] || (_cache[1] = ($event) => hoverItem(HelpIndex)),
              modelValue: _unref(hoveredItems)[HelpIndex]
            }, {
              trigger: _withCtx(({ attrs, on }) => [
                _createVNode(_unref(FeatherButton), _mergeProps({
                  link: "",
                  href: "#"
                }, attrs, _toHandlers(on), { class: "menubar-dropdown-button-dark" }), {
                  default: _withCtx(() => [
                    _createTextVNode(_toDisplayString(_unref(mainMenu).helpMenu.name) + " ", 1),
                    _createVNode(_unref(FeatherIcon), { icon: _unref(ArrowDropDown) }, null, 8, ["icon"])
                  ]),
                  _: 2
                }, 1040)
              ]),
              default: _withCtx(() => [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(mainMenu).helpMenu.items, (item) => {
                  return _openBlock(), _createBlock(_unref(FeatherDropdownItem), {
                    key: item.name || "",
                    onClick: ($event) => onMenuItemClick(item.url || "", item.isVueLink)
                  }, {
                    default: _withCtx(() => [
                      _createElementVNode("div", _hoisted_9, [
                        _createElementVNode("a", {
                          href: computeLink(item.url || "", item.isVueLink),
                          class: "dropdown-menu-link"
                        }, [
                          item.icon ? (_openBlock(), _createBlock(_component_font_awesome_icon, {
                            key: 0,
                            icon: `fa-solid ${item.icon}`
                          }, null, 8, ["icon"])) : _createCommentVNode("", true),
                          _createElementVNode("span", {
                            class: _normalizeClass({ "left-margin-small": item.icon })
                          }, _toDisplayString(item.name), 3)
                        ], 8, _hoisted_10)
                      ])
                    ]),
                    _: 2
                  }, 1032, ["onClick"]);
                }), 128))
              ]),
              _: 1
            }, 8, ["modelValue"])) : _createCommentVNode("", true),
            _createElementVNode("form", {
              ref_key: "logoutForm",
              ref: logoutForm,
              name: "vueLogoutForm",
              action: computeLogoutFormLink(),
              method: "post"
            }, null, 8, _hoisted_11),
            _unref(mainMenu).selfServiceMenu ? (_openBlock(), _createBlock(_unref(FeatherDropdown), {
              key: 2,
              class: "menubar-dropdown",
              onMouseenter: _cache[2] || (_cache[2] = ($event) => hoverItem(SelfServiceIndex)),
              modelValue: _unref(hoveredItems)[SelfServiceIndex]
            }, {
              trigger: _withCtx(({ attrs, on }) => [
                _createVNode(_unref(FeatherButton), _mergeProps({
                  link: "",
                  href: "#"
                }, attrs, _toHandlers(on), { class: "menubar-dropdown-button-dark" }), {
                  default: _withCtx(() => [
                    _unref(mainMenu).selfServiceMenu.icon && (_unref(mainMenu).selfServiceMenu.iconType === "feather" && _unref(mainMenu).selfServiceMenu.icon === "Person") || _unref(mainMenu).selfServiceMenu.iconType === "fa" && _unref(mainMenu).selfServiceMenu.icon === "fa-user" ? (_openBlock(), _createBlock(_unref(FeatherIcon), {
                      key: 0,
                      icon: _unref(Person)
                    }, null, 8, ["icon"])) : _createCommentVNode("", true),
                    _createTextVNode(" " + _toDisplayString(_unref(mainMenu).selfServiceMenu.name) + " ", 1),
                    _createVNode(_unref(FeatherIcon), { icon: _unref(ArrowDropDown) }, null, 8, ["icon"])
                  ]),
                  _: 2
                }, 1040)
              ]),
              default: _withCtx(() => [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(mainMenu).selfServiceMenu.items, (item) => {
                  return _openBlock(), _createBlock(_unref(FeatherDropdownItem), {
                    key: item.name || "",
                    onClick: ($event) => onSelfServiceMenuItemClick(item)
                  }, {
                    default: _withCtx(() => [
                      _createElementVNode("div", _hoisted_12, [
                        _createElementVNode("a", {
                          href: computeSelfServiceMenuLink(item),
                          class: "dropdown-menu-link"
                        }, [
                          item.icon ? (_openBlock(), _createBlock(_component_font_awesome_icon, {
                            key: 0,
                            icon: `fa-solid ${item.icon}`
                          }, null, 8, ["icon"])) : _createCommentVNode("", true),
                          _createElementVNode("span", {
                            class: _normalizeClass({ "left-margin-small": item.icon })
                          }, _toDisplayString(item.name), 3)
                        ], 8, _hoisted_13)
                      ])
                    ]),
                    _: 2
                  }, 1032, ["onClick"]);
                }), 128))
              ]),
              _: 1
            }, 8, ["modelValue"])) : _createCommentVNode("", true),
            _unref(mainMenu).userNotificationMenu ? (_openBlock(), _createBlock(_unref(FeatherDropdown), {
              key: 3,
              onMouseenter: _cache[4] || (_cache[4] = ($event) => hoverItem(UserIndex)),
              class: "menubar-dropdown",
              modelValue: _unref(hoveredItems)[UserIndex]
            }, {
              trigger: _withCtx(({ attrs, on }) => [
                _createVNode(_unref(FeatherButton), _mergeProps({
                  link: "",
                  href: "#"
                }, attrs, _toHandlers(on), { class: "menubar-dropdown-button-dark" }), {
                  default: _withCtx(() => [
                    _createElementVNode("span", {
                      class: _normalizeClass(["notification-badge-pill", _unref(userNotificationBadgeClass)])
                    }, _toDisplayString(_unref(notificationSummary).userUnacknowledgedCount), 3),
                    _createElementVNode("span", {
                      class: _normalizeClass(["notification-badge-pill", _unref(teamNotificationBadgeClass)])
                    }, _toDisplayString(_unref(notificationSummary).teamUnacknowledgedCount), 3),
                    _createVNode(_unref(FeatherIcon), { icon: _unref(ArrowDropDown) }, null, 8, ["icon"])
                  ]),
                  _: 2
                }, 1040)
              ]),
              default: _withCtx(() => [
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(mainMenu).userNotificationMenu.items?.filter((i) => i.id === "user"), (item) => {
                  return _openBlock(), _createBlock(_unref(FeatherDropdownItem), {
                    key: item.name || "",
                    onClick: ($event) => onMenuItemClick(item.url || "", item.isVueLink)
                  }, {
                    default: _withCtx(() => [
                      _createElementVNode("div", _hoisted_14, [
                        _createElementVNode("a", {
                          href: computeLink(item.url || ""),
                          class: "dropdown-menu-link dropdown-menu-wrapper"
                        }, [
                          item.icon ? (_openBlock(), _createBlock(_unref(FeatherIcon), {
                            key: 0,
                            icon: _unref(Person)
                          }, null, 8, ["icon"])) : _createCommentVNode("", true),
                          _createElementVNode("span", _hoisted_16, _toDisplayString(_unref(notificationSummary).userUnacknowledgedCount) + " notices assigned to you ", 1)
                        ], 8, _hoisted_15)
                      ])
                    ]),
                    _: 2
                  }, 1032, ["onClick"]);
                }), 128)),
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(notificationSummary).userUnacknowledgedNotifications.notification.slice(0, maxNotifications), (item) => {
                  return _openBlock(), _createBlock(_unref(FeatherDropdownItem), {
                    key: item.id || "",
                    class: "notification-dropdown-item",
                    onClick: ($event) => onNotificationItemClick(item)
                  }, {
                    default: _withCtx(() => [
                      _createElementVNode("div", _hoisted_17, [
                        _createElementVNode("div", _hoisted_18, [
                          _createElementVNode("div", {
                            onClick: ($event) => onNotificationItemClick(item),
                            class: "notification-dropdown-item-content-button"
                          }, [
                            _createElementVNode("i", {
                              class: _normalizeClass(`notification-badge-pill badge-severity-${item?.severity?.toLocaleLowerCase()}`)
                            }, null, 2),
                            _createElementVNode("div", _hoisted_20, [
                              _createElementVNode("div", null, [
                                _createElementVNode("span", _hoisted_21, _toDisplayString(new Date(item.pageTime).toLocaleDateString()) + " " + _toDisplayString(new Date(item.pageTime).toLocaleTimeString()), 1)
                              ]),
                              _createElementVNode("div", _hoisted_22, [
                                _createElementVNode("span", null, _toDisplayString(item.notificationName), 1),
                                _createElementVNode("span", null, _toDisplayString(item.nodeLabel), 1),
                                _createElementVNode("span", null, _toDisplayString(item.ipAddress), 1),
                                _createElementVNode("span", null, _toDisplayString(item.serviceType?.name), 1)
                              ])
                            ])
                          ], 8, _hoisted_19)
                        ])
                      ])
                    ]),
                    _: 2
                  }, 1032, ["onClick"]);
                }), 128)),
                _unref(notificationSummary).userUnacknowledgedCount > maxNotifications ? (_openBlock(), _createBlock(_unref(FeatherDropdownItem), { key: 0 }, {
                  default: _withCtx(() => [
                    _createElementVNode("div", _hoisted_23, [
                      _createElementVNode("div", _hoisted_24, [
                        _createElementVNode("a", {
                          href: _unref(notificationsShowMoreLink),
                          onClick: _cache[3] || (_cache[3] = ($event) => onMenuItemClick(_unref(notificationsShowMoreLink)))
                        }, "Show more...", 8, _hoisted_25)
                      ])
                    ])
                  ]),
                  _: 1
                })) : _createCommentVNode("", true),
                (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_unref(mainMenu).userNotificationMenu.items?.filter((i) => i.id !== "user"), (item) => {
                  return _openBlock(), _createBlock(_unref(FeatherDropdownItem), {
                    key: item.name || "",
                    onClick: ($event) => onMenuItemClick(item.url || "", item.isVueLink)
                  }, {
                    default: _withCtx(() => [
                      _createElementVNode("div", _hoisted_26, [
                        _createElementVNode("a", {
                          href: computeLink(item.url || ""),
                          class: "dropdown-menu-link dropdown-menu-wrapper final-menu-wrapper"
                        }, [
                          item.icon && item.id === "team" ? (_openBlock(), _createBlock(_component_font_awesome_icon, {
                            key: 0,
                            icon: "fa-solid fa-users"
                          })) : _createCommentVNode("", true),
                          item.icon && item.id === "oncall" ? (_openBlock(), _createBlock(_component_font_awesome_icon, {
                            key: 1,
                            icon: "fa-solid fa-calendar"
                          })) : _createCommentVNode("", true),
                          _createElementVNode("span", _hoisted_28, [
                            item.id === "team" ? (_openBlock(), _createElementBlock(_Fragment, { key: 0 }, [
                              _createTextVNode(_toDisplayString(_unref(notificationSummary).teamUnacknowledgedCount) + " of " + _toDisplayString(_unref(notificationSummary).totalUnacknowledgedCount) + " assigned to anyone but you ", 1)
                            ], 64)) : _createCommentVNode("", true),
                            item.id === "oncall" ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                              _createTextVNode(_toDisplayString(item.name), 1)
                            ], 64)) : _createCommentVNode("", true)
                          ])
                        ], 8, _hoisted_27)
                      ])
                    ]),
                    _: 2
                  }, 1032, ["onClick"]);
                }), 128))
              ]),
              _: 1
            }, 8, ["modelValue"])) : _createCommentVNode("", true),
            _unref(mainMenu).provisionMenu ? (_openBlock(), _createElementBlock("a", {
              key: 4,
              href: computeLink(_unref(mainMenu).provisionMenu?.url || ""),
              class: "top-menu-icon horiz-padding-small"
            }, [
              _createVNode(_unref(FeatherIcon), {
                icon: _unref(AddCircleAlt),
                class: "pointer light-dark",
                title: `${_unref(mainMenu).provisionMenu?.name || "Quick-Add Node"}`
              }, null, 8, ["icon", "title"])
            ], 8, _hoisted_29)) : _createCommentVNode("", true),
            _unref(mainMenu).flowsMenu ? (_openBlock(), _createElementBlock("a", {
              key: 5,
              href: computeLink(_unref(mainMenu).flowsMenu?.url || ""),
              class: "menu-link horiz-padding-small"
            }, [
              _createVNode(_component_font_awesome_icon, {
                icon: `fa-solid ${_unref(mainMenu).flowsMenu.icon || "fa-minus-circle"}`,
                class: "top-menu-icon",
                title: `${_unref(mainMenu).flowsMenu?.name || "Flow Management"}`
              }, null, 8, ["icon", "title"])
            ], 8, _hoisted_30)) : _createCommentVNode("", true),
            _unref(mainMenu).configurationMenu ? (_openBlock(), _createElementBlock("a", {
              key: 6,
              href: computeLink(_unref(mainMenu).configurationMenu.url || ""),
              class: "menu-link horiz-padding-small menubar-cogs"
            }, [
              _createVNode(_component_font_awesome_icon, {
                icon: `fa-solid ${_unref(mainMenu).configurationMenu.icon || "fa-cogs"}`,
                class: "top-menu-icon",
                title: `${_unref(mainMenu).configurationMenu?.name || "Configure OpenNMS"}`
              }, null, 8, ["icon", "title"])
            ], 8, _hoisted_31)) : _createCommentVNode("", true)
          ], 64)) : _createCommentVNode("", true)
        ]),
        _: 1
      }, 512);
    };
  }
});
export {
  stdin_default as default
};
