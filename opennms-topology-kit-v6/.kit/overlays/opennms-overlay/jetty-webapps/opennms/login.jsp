<jsp:include page="/includes/bootstrap.jsp" flush="false">
  <jsp:param name="title" value="Login" />
  <jsp:param name="quiet" value="true" />
</jsp:include>
<%@ taglib prefix='c' uri='http://java.sun.com/jsp/jstl/core'%>
<%@ taglib prefix='fn' uri='http://java.sun.com/jsp/jstl/functions'%>
<%--
/*******************************************************************************
 * This file is part of OpenNMS(R).
 *
 * Copyright (C) 2006-2015 The OpenNMS Group, Inc.
 * OpenNMS(R) is Copyright (C) 1999-2015 The OpenNMS Group, Inc.
 *
 * OpenNMS(R) is a registered trademark of The OpenNMS Group, Inc.
 *
 * OpenNMS(R) is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * OpenNMS(R) is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with OpenNMS(R).  If not, see:
 *      http://www.gnu.org/licenses/
 *
 * For more information contact:
 *     OpenNMS(R) Licensing <license@opennms.org>
 *     http://www.opennms.org/
 *     http://www.opennms.com/
 *******************************************************************************/
--%>
<jsp:include page="/includes/mobile-app-promo.jsp" flush="false" />

<style type="text/css">

  .login-page {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    /*overflow: auto;*/
    background-color: #40B498;
    height: 100%;
    padding: 0;
  }

  .container {
  padding: 7.2% 0 0 0;
}

.row {
  width: 100%;
  display: flex;
  flex-flow: row wrap;
  box-sizing: border-box;
}

.group_in_cols {
  display: flex;
  flex-flow: column wrap;
  line-height: 1;
}

.col-sm-4, .col-md-4, .col-lg-4 {
  width: 33%;
}

.mvn-logo-wrapper {
  width: 100%;
  padding: 0;
  display: flex;
  direction: flex-start;
}
.mvn-logo {
  width: 50%;
  padding-right: 4px;
}

#maven_logo {
 width: 100%;
}

.nms-logo {
  width: 40%;  
  display: flex;
  direction: flex-end;
  justify-content: flex-start;
  align-items: flex-end;
  padding: 0;
}

span.nms {
  padding: 0;
  margin: 0;
  font-size: 32px; 
  color: #666771;
  height: 34px;
}

form {
  margin-top: 35px;
}

form label {
  font-weight: 500;
  color: #555660;
}

form .form-control {
  height: 34px;
  width: 100%;
}

form input[type="text"]:focus,
form input[type="password"]:focus {
    outline: none;
}

.has-error {
    color: #515151;
      font-size: 16px;
      height: 0px;
}

form button[type="submit"] {
  margin-top: 30px;
  font-weight: 600;
}

.btn-default {
  background-color: #666771;
  color: #FFF;
  border-color: grey;
}

.btn-default:hover {
  background-color: darken(#666771, 4.5%);
}

.btn {
  border: 1px solid darken(#666771, 4.5%);
}

.login_footer {
  color: #FFF;
  position: absolute;
  padding-bottom: 30px;
  padding-left: 50px;
  bottom: 0;
}

.login_footer span {
  font-weight: bold;
}

</style>

<%
  // Spring Security remembers the requested URL and redirects after a successful login.
  // If the session_expired parameter is set, it is known that this is a Javascript redirect.
  // In this case, we remove the remembered request attribute so the user is forwarded to the login page instead.
  if (request.getParameter("session_expired") != null
          && request.getParameter("session_expired").equals("true")
          && session != null) {
      session.removeAttribute("SPRING_SECURITY_SAVED_REQUEST");
  }
%>

<div class="login-page">
  <div class="container">
		<div class="row">
			<div class="col-sm-4 col-md-4 col-lg-4"></div>
			<div class="col-sm-4 col-md-4 col-lg-4">
				<div class="mvn-logo-wrapper">
					<div class="mvn-logo">
						<img id="maven_logo" src="images/maven_symbol_white.png">
					</div>
					<div class="nms-logo">
						<span class="nms"> NMS</span>
					</div>
				</div>
				

				<form class="" name="loginForm" role="form" method="post" action="<c:url value='j_spring_security_check'/>">
<%-- Added by the topology kit, in the development OpenNMS only: OpenNMS 33.1.8 accepts a login only with this token. --%>
<input type="hidden" name="${_csrf.parameterName}" value="${_csrf.token}"/>
					<div class="form-group group_in_cols">
            					<label for="Username">Username</label>
						<label for="input_j_username" class="sr-only">Username</label>
						<input type="text" class="form-control input-underline form-control-lg" id="input_j_username" name="j_username"
            <%-- This is deprecated and requires a custom AuthenticationFailureHandler to function properly --%>
                   <c:if test="${not empty param.login_error}">value='<c:out value="${SPRING_SECURITY_LAST_USERNAME}"/>'</c:if>
                   placeholder="Username" autofocus="autofocus" autocomplete="username" required />
					</div>
					<div class="form-group group_in_cols">
						<label for="Password">Password</label>
						<label for="j_password" class="sr-only">Password</label>
            <input type="password" class="form-control input-underline form-control-lg" id="input_j_password" name="j_password" placeholder="Password" autocomplete="current-password" required>
					</div>
					<c:if test="${not empty param.session_expired}">
            <div class="alert alert-warning">
              <strong>Session expired</strong> Please log back in.
            </div>
          </c:if>

          <c:if test="${not empty param.login_error}">
            <div id="login-attempt-failed" class="alert alert-danger">
              Your log-in attempt failed,  please try again.

                <%-- This is: AbstractProcessingFilter.SPRING_SECURITY_LAST_EXCEPTION_KEY --%>
              <p id="login-attempt-failed-reason">Reason: ${SPRING_SECURITY_LAST_EXCEPTION.message}</p>
              <%-- Check if the failure is due to host resolution issues --%>
              <c:if test="${fn:contains(SPRING_SECURITY_LAST_EXCEPTION.message, 'UnknownHostException')}">
                <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); font-size: 12px;">
                  <strong>Troubleshooting:</strong> Host DNS resolution failed inside container. Add the host mapping to <code>EXTRA_HOSTS</code> in <code>maven-nms.env</code> (e.g. <code>EXTRA_HOSTS="hostname:IP"</code>) and restart OpenNMS.
                </div>
              </c:if>
            </div>
          </c:if>

          <div class="form-group group_in_cols">
            <input name="j_usergroups" type="hidden" value=""/>
            <button type="submit" class="btn btn-default btn-block">Log In</button>
          </div>
        </div>
      </form>
			</div>
			<div class="col-sm-4 col-md-4 col-lg-4"></div>
		</div>
	</div>
	<div class="row">
		<div class="col-sm-12 col-md-12 col-lg-12 login_footer">
			2026 <span>&copy;</span> Maven Wireless Sweden AB
		</div>
	</div>
</div>
